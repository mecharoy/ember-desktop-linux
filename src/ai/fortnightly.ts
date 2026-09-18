// Fortnightly memory summaries.
//
// As the journal grows, the evening chat can't carry every entry. So every
// two weeks the entries no summary has covered yet are folded, together with
// the previous summary, into a new systematic summary. Until summary n is
// written, the chat reads summary n-1 plus every entry written since it.
//
// Coverage is tracked by the exact entry dates each summary used
// (source_days), not by a date range, so a late entry — a past day written up
// afterwards, or one moved to another date — is never lost: it is simply
// uncovered, and the next summary folds it in.

import { z } from "zod";
import { contextBudget } from "./budget";
import { getProvider } from "./factory";
import { extractJson } from "./json";
import { JOB_REPLY_TOKENS } from "./replySizes";
import {
  FORTNIGHT_SYSTEM_PROMPT,
  buildFortnightUserPrompt,
  type FortnightNumbers,
  type FortnightPromptInput,
} from "./prompts/fortnightly";
import { sourceDaysKey } from "./review";
import { localDateKey } from "../time";
import { listEntries } from "../db/entries";
import { listAllDayMetrics } from "../db/metrics";
import { listAssessments } from "../db/assessments";
import { listMemorySummaries, saveMemorySummary } from "../db/memorySummaries";
import { getSetting } from "../db/settings";
import { addDays, avgOf, parseDayRows } from "../insights/stats";
import type { DayMetrics, Entry, MemorySummary } from "../db/types";
import type { AIProvider } from "./types";
import { localStamp } from "../time";

export const FORTNIGHT_DAYS = 14;

const THREAD_STATUSES = ["new", "ongoing", "improving", "worsening", "resolved"] as const;

export const FortnightSummarySchema = z.object({
  overview: z.string().min(1),
  life_context: z.string().default(""),
  mood_and_energy: z.string().default(""),
  sleep_and_routine: z.string().default(""),
  relationships: z.string().default(""),
  strengths_and_coping: z.string().default(""),
  patterns: z.string().default(""),
  wellbeing_checks: z.string().default(""),
  threads: z
    .array(
      z.object({
        thread: z.string().min(1),
        status: z.enum(THREAD_STATUSES).catch("ongoing"),
        note: z.string().default(""),
        dates: z.array(z.string()).default([]),
      }),
    )
    .catch([]),
  open_loops: z.array(z.string()).catch([]),
  follow_up: z.array(z.string()).catch([]),
});

export type FortnightSummary = z.infer<typeof FortnightSummarySchema>;

/** Every entry date any summary has already folded in. */
export function coveredDays(summaries: Pick<MemorySummary, "source_days">[]): Set<string> {
  return new Set(summaries.flatMap((s) => s.source_days.split(",").filter(Boolean)));
}

/**
 * The next summary to write, or null. It is due once the fortnight starting
 * at the oldest uncovered entry is fully over; it takes every uncovered entry
 * inside that fortnight. The day being lived (today) is never folded in. With
 * a backlog this returns the oldest fortnight first, one at a time.
 */
export function dueFortnight(
  todayKey: string,
  entryDates: string[],
  summaries: Pick<MemorySummary, "number" | "source_days">[],
): { number: number; dates: string[] } | null {
  const covered = coveredDays(summaries);
  const uncovered = Array.from(new Set(entryDates))
    .filter((d) => d < todayKey && !covered.has(d))
    .sort();
  if (uncovered.length === 0) return null;
  const windowEnd = addDays(uncovered[0], FORTNIGHT_DAYS - 1);
  if (windowEnd >= todayKey) return null;
  const number = summaries.reduce((max, s) => Math.max(max, s.number), 0) + 1;
  return { number, dates: uncovered.filter((d) => d <= windowEnd) };
}

const HEADINGS: [keyof FortnightSummary, string][] = [
  ["overview", "Overview"],
  ["life_context", "Life context"],
  ["mood_and_energy", "Mood and energy"],
  ["sleep_and_routine", "Sleep and routine"],
  ["relationships", "Relationships"],
  ["strengths_and_coping", "Strengths and coping"],
  ["patterns", "Patterns noticed"],
  ["wellbeing_checks", "Wellbeing questionnaires"],
];

/** The summary as stable text — for the chat's system prompt and for the
 *  next summary's PREVIOUS SUMMARY block. */
export function formatSummaryForPrompt(row: Pick<MemorySummary, "number" | "period_start" | "period_end" | "summary">): string {
  let s: FortnightSummary;
  try {
    s = FortnightSummarySchema.parse(JSON.parse(row.summary));
  } catch {
    return "(unreadable)";
  }
  const lines = [`Summary #${row.number}, covering entries from ${row.period_start} to ${row.period_end}.`];
  for (const [key, label] of HEADINGS) {
    const text = (s[key] as string).trim();
    if (text) lines.push(`${label}: ${text}`);
  }
  if (s.threads.length > 0) {
    lines.push("Ongoing threads:");
    for (const t of s.threads) {
      const dates = t.dates.length > 0 ? ` (${t.dates.join(", ")})` : "";
      lines.push(`- [${t.status}] ${t.thread}${t.note ? ` — ${t.note}` : ""}${dates}`);
    }
  }
  if (s.open_loops.length > 0) lines.push("Open loops:", ...s.open_loops.map((l) => `- ${l}`));
  if (s.follow_up.length > 0) lines.push("Worth gently following up:", ...s.follow_up.map((l) => `- ${l}`));
  return lines.join("\n");
}

/** Caps the entries the chat carries: ~6k tokens. Only a backlog the
 *  summary job hasn't caught up on yet can reach it. */
export const JOURNALS_BUDGET_CHARS = 24_000;

/**
 * The entries written since the latest summary, for the chat: every entry no
 * summary covers, dated before the day being talked about (that day's own
 * conversation is the chat itself), oldest first. Over budget, the newest
 * are kept and the older ones only named.
 */
export function formatJournalsSince(
  entries: Pick<Entry, "date" | "title" | "narrative">[],
  summaries: Pick<MemorySummary, "source_days">[],
  dayKey: string,
  budget = JOURNALS_BUDGET_CHARS,
): string {
  const covered = coveredDays(summaries);
  const pending = entries.filter((e) => e.date < dayKey && !covered.has(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (pending.length === 0) return "(none)";

  const blocks: string[] = [];
  let used = 0;
  let firstKept = pending.length;
  for (let i = pending.length - 1; i >= 0; i--) {
    const e = pending[i];
    const block = `${e.date} — ${e.title}\n${e.narrative.trim()}`;
    if (used + block.length > budget && blocks.length > 0) break;
    blocks.unshift(block);
    used += block.length;
    firstKept = i;
  }
  const omitted = pending.slice(0, firstKept).map((e) => e.date);
  const note = omitted.length > 0 ? `(${omitted.length} older entries not shown for space: ${omitted.join(", ")})\n\n` : "";
  return note + blocks.join("\n\n");
}

/** The period's numbers, computed here so the model quotes them. Pure. */
export function fortnightNumbers(dates: string[], metrics: Pick<DayMetrics, "date" | "mood" | "energy" | "summary_line" | "raw_json">[]): FortnightNumbers {
  const set = new Set(dates);
  const rows = parseDayRows(metrics.filter((m) => set.has(m.date)));
  const sorted = dates.slice().sort();
  return {
    from: sorted[0],
    to: sorted[sorted.length - 1],
    entries: dates.length,
    avgMood: avgOf(rows.map((r) => r.mood).filter((v): v is number => v !== null)),
    avgEnergy: avgOf(rows.map((r) => r.energy).filter((v): v is number => v !== null)),
    avgSleepHours: avgOf(rows.map((r) => r.x.sleep_hours).filter((v): v is number => v !== null)),
  };
}

export type FortnightResult = { ok: true; summary: FortnightSummary } | { ok: false; error: string };

/** Validated + retried once; provider injected for tests. */
export async function fortnightWithProvider(provider: AIProvider, input: FortnightPromptInput): Promise<FortnightResult> {
  const basePrompt = buildFortnightUserPrompt(input);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response could not be parsed as valid JSON matching the required shape: ${lastError}\nReturn ONLY the corrected JSON object, nothing else.`;
    try {
      const raw = await provider.complete([{ role: "user", content: prompt }], FORTNIGHT_SYSTEM_PROMPT, {
        maxTokens: JOB_REPLY_TOKENS.memory,
      });
      return { ok: true, summary: FortnightSummarySchema.parse(extractJson(raw)) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

/** A backlog (an older journal meeting this feature) catches up a few
 *  fortnights per run rather than all at once. */
const MAX_PER_RUN = 3;

let running: Promise<FortnightResult | null> | null = null;

/** Joins a run already in progress instead of writing the same summary twice. */
export function runFortnightlySummaryIfDue(): Promise<FortnightResult | null> {
  if (!running) {
    running = runOnce().finally(() => {
      running = null;
    });
  }
  return running;
}

async function runOnce(): Promise<FortnightResult | null> {
  let last: FortnightResult | null = null;
  for (let i = 0; i < MAX_PER_RUN; i++) {
    const [entries, summaries, metrics, assessments, userName] = await Promise.all([
      listEntries(),
      listMemorySummaries(),
      listAllDayMetrics(),
      listAssessments(),
      getSetting("user_name"),
    ]);
    const due = dueFortnight(localDateKey(), entries.map((e) => e.date), summaries);
    if (!due) break;

    const dates = new Set(due.dates);
    const batch = entries.filter((e) => dates.has(e.date)).sort((a, b) => a.date.localeCompare(b.date));
    const numbers = fortnightNumbers(due.dates, metrics);
    const summaryLines = new Map(metrics.map((m) => [m.date, m.summary_line]));
    const previous = summaries[summaries.length - 1];

    // Small models: the day's summary line and highlights stand in for the
    // full narrative, so two weeks fit.
    const compact = (await contextBudget()).mode === "compact";
    let result: FortnightResult;
    try {
      result = await fortnightWithProvider(await getProvider(), {
        userName: userName.trim(),
        number: due.number,
        previous: previous ? formatSummaryForPrompt(previous) : null,
        numbers,
        entries: batch.map((e) => ({
          date: e.date,
          title: e.title,
          narrative: compact ? (summaryLines.get(e.date) ?? e.narrative.slice(0, 300)) : e.narrative,
          highlights: parseHighlights(e.highlights),
          summaryLine: summaryLines.get(e.date) ?? null,
        })),
        assessments: assessments.filter((a) => a.date >= numbers.from && a.date <= numbers.to),
      });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    last = result;
    if (!result.ok) break;
    await saveMemorySummary({
      number: due.number,
      periodStart: numbers.from,
      periodEnd: numbers.to,
      summary: JSON.stringify(result.summary),
      sourceDays: sourceDaysKey(due.dates),
      createdAt: localStamp(),
    });
  }
  return last;
}

function parseHighlights(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}
