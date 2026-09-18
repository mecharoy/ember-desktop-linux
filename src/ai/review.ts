import { z } from "zod";
import { getProvider } from "./factory";
import { extractJson } from "./json";
import { JOB_REPLY_TOKENS } from "./replySizes";
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserPrompt,
  type ReviewPromptInput,
} from "./prompts/review";
import { localDateKey } from "../time";
import { listAllDayMetrics } from "../db/metrics";
import { getProfileSummary, setProfileSummary } from "../db/profile";
import { listWeeklyReviews, saveWeeklyReview } from "../db/reviews";
import { getSetting } from "../db/settings";
import type { DayMetrics, WeeklyReview } from "../db/types";
import { addDays, mondayOf } from "../insights/stats";
import type { AIProvider } from "./types";
import { contextBudget } from "./budget";
import { compactDayLine } from "./compactDays";
import { localStamp } from "../time";

const claim = z.object({
  claim: z.string().min(1),
  evidence: z.string().min(1),
  // The days the evidence comes from, so the card can open those entries
  // Optional — a claim without dates links to the week.
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(7).default([]),
});

export const WeeklyReviewSchema = z.object({
  letter: z.string().min(1),
  strengths: z.array(claim).max(4).default([]),
  focus_areas: z.array(claim).max(4).default([]),
  new_profile_summary: z.string().min(1),
});

export type WeeklyReviewDraft = z.infer<typeof WeeklyReviewSchema>;

export type ReviewResult =
  | { ok: true; review: WeeklyReviewDraft }
  | { ok: false; error: string };

/** Validated + retried-once review call; provider
 * injected so tests can drive it with a stub. */
export async function reviewWithProvider(
  provider: AIProvider,
  input: ReviewPromptInput,
): Promise<ReviewResult> {
  const basePrompt = buildReviewUserPrompt(input);

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response could not be parsed as valid JSON matching the required shape: ${lastError}\nReturn ONLY the corrected JSON object, nothing else.`;

    try {
      const raw = await provider.complete([{ role: "user", content: prompt }], REVIEW_SYSTEM_PROMPT, {
        maxTokens: JOB_REPLY_TOKENS.weekly,
      });
      const review = WeeklyReviewSchema.parse(extractJson(raw));
      return { ok: true, review };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, error: lastError };
}

/** The identity of a set of days, as stored in weekly_reviews.source_days. */
export function sourceDaysKey(dates: string[]): string {
  return Array.from(new Set(dates)).sort().join(",");
}

export interface ExistingReview {
  weekStart: string;
  sourceDays: string | null;
}

/** A week is over — and so reviewable — from the Monday after it, or on its
 * Sunday once that Sunday's entry has been extracted. The old rule fired as
 * soon as Sunday began (in practice just after midnight), so the letter was
 * written before the week's last day existed and was never revisited. */
function weekIsComplete(weekStart: string, todayKey: string, metricDates: Set<string>): boolean {
  const sunday = addDays(weekStart, 6);
  return todayKey > sunday || (todayKey === sunday && metricDates.has(sunday));
}

/**
 * Which week needs a review as of `todayKey`, oldest first, one per call (the
 * scheduler re-checks every ~30 min, so a backlog fills in gradually):
 * - a complete week with extracted days and no review yet, or
 * - a reviewed week whose extracted days changed after it was written (a late
 *   entry, a re-read) — the review is stale and gets rewritten. Rows from
 *   before migration 0007 don't record their days and are left alone.
 * Weeks with no data are skipped, never reviewed. Null when nothing is due.
 */
export function dueReviewWeek(
  todayKey: string,
  metricDates: string[],
  existing: ExistingReview[],
): string | null {
  if (metricDates.length === 0) return null;
  const dateSet = new Set(metricDates);
  const byWeek = new Map(existing.map((r) => [r.weekStart, r]));
  const earliest = mondayOf(metricDates.reduce((a, b) => (a < b ? a : b)));

  for (let week = earliest; weekIsComplete(week, todayKey, dateSet); week = addDays(week, 7)) {
    const weekEnd = addDays(week, 6);
    const days = metricDates.filter((d) => d >= week && d <= weekEnd);
    if (days.length === 0) continue;
    const review = byWeek.get(week);
    if (!review) return week;
    if (review.sourceDays !== null && review.sourceDays !== sourceDaysKey(days)) return week;
  }
  return null;
}

/** Whether a review of `weekStart` may rewrite the profile. The profile is a
 * portrait of who they are now, so only the newest reviewed week may touch
 * it — and a one-day week may seed a first profile but not overwrite one. */
export function mayRewriteProfile(
  weekStart: string,
  reviewedWeeks: string[],
  dayCount: number,
  hasProfile: boolean,
): boolean {
  const isNewest = reviewedWeeks.every((w) => w <= weekStart);
  return isNewest && (dayCount >= 2 || !hasProfile);
}

async function writeReview(
  weekStart: string,
  metrics: DayMetrics[],
  reviews: WeeklyReview[],
): Promise<ReviewResult> {
  const weekEnd = addDays(weekStart, 6);
  const days = metrics.filter((m) => m.date >= weekStart && m.date <= weekEnd);
  // Standing cards come from the review just before this week, so a rewrite
  // of an old week never inherits cards from a later one.
  const previous = reviews.find((r) => r.week_start < weekStart) ?? null; // reviews: newest first
  const [currentProfile, budget] = await Promise.all([getProfileSummary(), contextBudget()]);
  // Small models read one plain line per day instead of the JSON record.
  const compact = budget.mode === "compact";

  const input: ReviewPromptInput = {
    weekStart,
    weekEnd,
    days: days.map((m) => ({ date: m.date, rawJson: compact ? compactDayLine(m.raw_json) : m.raw_json })),
    currentProfile,
    currentStrengths: previous?.strengths ?? "[]",
    currentFocusAreas: previous?.focus_areas ?? "[]",
    userName: (await getSetting("user_name")).trim(),
  };

  let result: ReviewResult;
  try {
    result = await reviewWithProvider(await getProvider(), input);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (result.ok) {
    const stamp = localStamp();
    await saveWeeklyReview({
      weekStart,
      letter: result.review.letter,
      strengths: result.review.strengths,
      focusAreas: result.review.focus_areas,
      createdAt: stamp,
      sourceDays: sourceDaysKey(days.map((d) => d.date)),
    });
    if (mayRewriteProfile(weekStart, reviews.map((r) => r.week_start), days.length, Boolean(currentProfile))) {
      await setProfileSummary(result.review.new_profile_summary, stamp);
    }
  }
  return result;
}

// Review jobs run one at a time. The scheduler, the Insights refresh and the
// post-extraction hook can all ask at once; the second caller then finds
// nothing due instead of paying for the same review twice.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/**
 * The weekly review job. Checks whether a review is due, runs it, saves the
 * letter + cards, and rewrites the rolling profile summary when
 * allowed. Failures degrade silently — the job tries again on the next check.
 */
export function runWeeklyReviewIfDue(): Promise<ReviewResult | null> {
  return exclusive(async () => {
    const [metrics, reviews] = await Promise.all([listAllDayMetrics(), listWeeklyReviews()]);
    const week = dueReviewWeek(
      localDateKey(),
      metrics.map((m) => m.date),
      reviews.map((r) => ({ weekStart: r.week_start, sourceDays: r.source_days })),
    );
    return week ? writeReview(week, metrics, reviews) : null;
  });
}

/**
 * "Update this week's review": writes the review of the week in progress
 * from the days so far. When the week ends its days differ from the ones
 * recorded here, so the automatic job rewrites it as a full-week review.
 * Null when the week has no extracted days yet.
 */
export function writeCurrentWeekReview(): Promise<ReviewResult | null> {
  return exclusive(async () => {
    const week = mondayOf(localDateKey());
    const weekEnd = addDays(week, 6);
    const [metrics, reviews] = await Promise.all([listAllDayMetrics(), listWeeklyReviews()]);
    if (!metrics.some((m) => m.date >= week && m.date <= weekEnd)) return null;
    return writeReview(week, metrics, reviews);
  });
}
