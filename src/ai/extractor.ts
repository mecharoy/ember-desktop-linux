import { z } from "zod";
import { emit } from "@tauri-apps/api/event";
import { getProvider } from "./factory";
import { extractJson } from "./json";
import { JOB_REPLY_TOKENS } from "./replySizes";
import {
  EXTRACTOR_SYSTEM_PROMPT,
  buildExtractorUserPrompt,
  type ExtractorPromptInput,
} from "./prompts/extractor";
import { listAllDayMetrics, listEntriesNeedingExtraction, upsertDayMetrics } from "../db/metrics";
import { parseDayRows } from "../insights/stats";
import { knownActivityNames } from "../insights/activation";
import { groundThinkingTraps } from "../insights/thinking";
import { listObservations, rebuildObservations } from "../db/observations";
import { canonicalKey } from "../db/observationFold";
import { listDismissedHabitKeys } from "../db/habitPrefs";
import { getCheckIn } from "../db/checkins";
import { feelingWords, formatCheckInForPrompt, toCheckInSummary, type CheckInSummary } from "./checkin";
import { listMessages } from "../db/sessions";
import { listEntries } from "../db/entries";
import { runReviewJobsAndNotify } from "./reviewJobs";
import type { Entry, Message } from "../db/types";
import type { AIProvider } from "./types";
import { contextBudget } from "./budget";
import { estimateTokens } from "./tokens";
import { clip } from "./relevance";
import {
  EXTRACT_DAY_SYSTEM_PROMPT,
  EXTRACT_PERSON_SYSTEM_PROMPT,
  buildExtractCompactPrompt,
} from "./prompts/extractorCompact";

const sentiment = z.number().min(-1).max(1);

// The newer fields (activities, thinking traps, routine) fall back instead of failing: a free model
// that fumbles an optional enjoyment score must not cost the whole day's
// extraction (and the retry) when mood, themes and habits came back fine.
const score03 = z.number().int().min(0).max(3).nullable().catch(null);
const clockField = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/)
  .nullable()
  .catch(null);

// Local models are weak at JSON discipline, so lists default
// to empty and unclear numbers are null — but shapes that ARE present must be
// right, and out-of-range values fail validation (triggering the one retry).
export const ExtractionSchema = z.object({
  mood: z.number().int().min(1).max(10).nullable().default(null),
  energy: z.number().int().min(1).max(10).nullable().default(null),
  summary_line: z.string().min(1).nullable().default(null),
  themes: z.array(z.object({ key: z.string().min(1), sentiment })).default([]),
  habits: z.array(z.object({ key: z.string().min(1), done: z.boolean() })).default([]),
  people: z.array(z.object({ key: z.string().min(1), sentiment })).default([]),
  emotions: z.array(z.string().min(1)).default([]),
  emotions_named: z.array(z.string().min(1)).default([]),
  sleep_hours: z.number().min(0).max(24).nullable().default(null),
  strengths_shown: z.array(z.string().min(1)).default([]),
  struggles_shown: z.array(z.string().min(1)).default([]),
  activities: z.array(z.object({ key: z.string().min(1), pleasure: score03, mastery: score03 })).catch([]),
  thinking_traps: z.array(z.object({ type: z.string().min(1), quote: z.string().min(1) })).catch([]),
  rhythm: z
    .object({ first_contact: clockField, work_start: clockField, dinner: clockField })
    .catch({ first_contact: null, work_start: null, dinner: null }),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/** What gets stored in day_metrics.raw_json: the extraction with the user's
 * own check-in applied, plus where the mood came from. */
export type StoredExtraction = Extraction & { mood_source: "user" | "ai" | null };

/**
 * The user's check-in beats the model's reading: mood, energy and sleep are
 * copied over, pinned-habit answers replace whatever the text suggested, and
 * their feeling words count as words they named. Pure — unit-tested.
 */
export function applyCheckIn(x: Extraction, c: CheckInSummary | null): StoredExtraction {
  if (!c) return { ...x, mood_source: x.mood === null ? null : "ai" };
  const habits = new Map(x.habits.map((h) => [canonicalKey(h.key), h]));
  for (const [key, done] of Object.entries(c.habits)) habits.set(canonicalKey(key), { key, done });
  const named = new Set([...x.emotions_named.map((e) => e.trim().toLowerCase()), ...feelingWords(c.feeling)]);
  const mood = c.mood ?? x.mood;
  return {
    ...x,
    mood,
    energy: c.energy ?? x.energy,
    sleep_hours: c.sleepHours ?? x.sleep_hours,
    habits: Array.from(habits.values()),
    emotions_named: Array.from(named).filter(Boolean),
    mood_source: c.mood !== null ? "user" : mood === null ? null : "ai",
  };
}

/**
 * What the model returned, held to what the user actually said: a thinking
 * trap survives only if its quote is in their own messages or check-in words
 * (never Elytra's lines or the written entry), and activities are capped. Pure.
 */
export function groundExtraction(
  x: Extraction,
  transcript: Pick<Message, "role" | "content">[],
  checkIn: CheckInSummary | null,
): Extraction {
  const userText = [
    ...transcript.filter((m) => m.role === "user").map((m) => m.content),
    checkIn?.feeling ?? "",
    checkIn?.onMind ?? "",
  ].join("\n");
  return {
    ...x,
    activities: x.activities.slice(0, 8),
    thinking_traps: groundThinkingTraps(x.thinking_traps, userText),
  };
}

export type ExtractionResult =
  | { ok: true; extraction: Extraction }
  | { ok: false; error: string };

/**
 * Provider-level extraction: validated, retried once with the parse error
 * appended. Takes the provider as an argument so
 * tests can drive it with a stub.
 */
export async function extractWithProvider(
  provider: AIProvider,
  input: ExtractorPromptInput,
): Promise<ExtractionResult> {
  const basePrompt = buildExtractorUserPrompt(input);

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response could not be parsed as valid JSON matching the required shape: ${lastError}\nReturn ONLY the corrected JSON object, nothing else.`;

    try {
      const raw = await provider.complete([{ role: "user", content: prompt }], EXTRACTOR_SYSTEM_PROMPT, {
        maxTokens: JOB_REPLY_TOKENS.extract,
      });
      const extraction = ExtractionSchema.parse(extractJson(raw));
      return { ok: true, extraction };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, error: lastError };
}

/** One part of the compact extraction: validated against the full schema's
 *  fields for that part, retried once. */
async function extractPart(
  provider: AIProvider,
  system: string,
  prompt: string,
  pick: (x: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = attempt === 0 ? prompt : `${prompt}\n\nYour previous response could not be used: ${lastError}\nReturn ONLY the corrected JSON object.`;
    try {
      const raw = await provider.complete([{ role: "user", content: text }], system, { maxTokens: 700 });
      const parsed = extractJson(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not a JSON object.");
      const part = cleanCompactPart(pick(parsed as Record<string, unknown>));
      // The schema defaults fill what's missing; this checks what is there.
      ExtractionSchema.parse(part);
      return part;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastError);
}

/** Drops list items a small model got wrong (a habit with "done": null, a
 *  sentiment of "high") so one bad item doesn't fail the whole day, and
 *  clamps numbers into range. Pure. */
export function cleanCompactPart(x: Record<string, unknown>): Record<string, unknown> {
  const out = { ...x };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((i) => i && typeof i === "object") : []);
  const clamp = (n: unknown, lo: number, hi: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null);
  const keyed = (v: unknown) => list(v).filter((i) => typeof (i as { key?: unknown }).key === "string" && (i as { key: string }).key.trim());
  if ("themes" in x) out.themes = keyed(x.themes).map((t) => ({ ...t, sentiment: clamp((t as { sentiment?: unknown }).sentiment, -1, 1) ?? 0 }));
  if ("people" in x) out.people = keyed(x.people).map((p) => ({ ...p, sentiment: clamp((p as { sentiment?: unknown }).sentiment, -1, 1) ?? 0 }));
  if ("habits" in x) out.habits = keyed(x.habits).filter((h) => typeof (h as { done?: unknown }).done === "boolean");
  if ("activities" in x) out.activities = keyed(x.activities);
  for (const f of ["mood", "energy"]) if (f in x) out[f] = typeof x[f] === "number" ? clamp(Math.round(x[f] as number), 1, 10) : null;
  for (const f of ["emotions", "emotions_named", "strengths_shown", "struggles_shown"]) {
    if (f in x) out[f] = Array.isArray(x[f]) ? (x[f] as unknown[]).filter((w) => typeof w === "string" && w.trim()) : [];
  }
  return out;
}

/** The two parts as one extraction, with the feeling words held to what
 *  they typed. Pure. */
export function mergeCompactParts(day: Record<string, unknown>, person: Record<string, unknown>, typedText: string): Extraction {
  const x = ExtractionSchema.parse({ ...cleanCompactPart(day), ...cleanCompactPart(person) });
  const typed = typedText.toLowerCase();
  const named = Array.from(new Set(x.emotions_named.flatMap((w) => feelingWords(w)))).filter((w) => typed.includes(w));
  return { ...x, emotions_named: named };
}

const DAY_FIELDS = ["mood", "energy", "summary_line", "themes", "habits", "people", "sleep_hours", "rhythm"];
const PERSON_FIELDS = ["emotions", "emotions_named", "strengths_shown", "struggles_shown", "activities"];
const only = (fields: string[]) => (x: Record<string, unknown>) => Object.fromEntries(fields.filter((f) => f in x).map((f) => [f, x[f]]));

/**
 * Extraction for small models: two short jobs instead of one long one. The
 * day's facts are required; if the second part fails, the day keeps them
 * with the person fields empty rather than losing both.
 */
export async function extractCompact(provider: AIProvider, input: ExtractorPromptInput, totalTokens: number): Promise<ExtractionResult> {
  const theirs = input.transcript.filter((m) => m.role === "user").map((m) => `- ${m.content}`).join("\n");
  const withoutWords = estimateTokens(EXTRACT_DAY_SYSTEM_PROMPT) + estimateTokens(buildExtractCompactPrompt(input, ""));
  const prompt = buildExtractCompactPrompt(input, clip(theirs, Math.max(300, totalTokens - withoutWords - 900)));
  try {
    const day = await extractPart(provider, EXTRACT_DAY_SYSTEM_PROMPT, prompt, only(DAY_FIELDS));
    const person = await extractPart(provider, EXTRACT_PERSON_SYSTEM_PROMPT, prompt, only(PERSON_FIELDS)).catch(() => ({}));
    // Small models put phrases in emotions_named ("tired, a bit tense"): only
    // feeling words they actually typed are kept.
    return { ok: true, extraction: mergeCompactParts(day, person, [theirs, input.checkIn ?? ""].join("\n")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Dates being extracted right now. The Insights refresh skips them, so an
// entry saved a moment ago isn't extracted twice in parallel.
const inFlight = new Set<string>();

/** Known names (most-used first, dismissed habits left out), the dismissed
 * list, and the day's check-in — what the extractor needs beyond the entry. */
async function extractionContext(date: string) {
  const [observations, dismissed, checkInRow, metrics] = await Promise.all([
    listObservations(),
    listDismissedHabitKeys(),
    getCheckIn(date),
    listAllDayMetrics(),
  ]);
  const names = (kind: "theme" | "habit" | "person") =>
    observations
      .filter((o) => o.kind === kind && !(kind === "habit" && dismissed.has(canonicalKey(o.key))))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 40)
      .map((o) => o.key);
  return {
    knownNames: {
      themes: names("theme"),
      habits: names("habit"),
      people: names("person"),
      activities: knownActivityNames(parseDayRows(metrics.filter((m) => m.date !== date))),
    },
    dismissedHabits: Array.from(dismissed),
    checkIn: toCheckInSummary(checkInRow),
  };
}

/** Extracts one day and stores it. On double failure the
 * day keeps whatever the user entered in the check-in and raw_json "{}",
 * which marks it for the Insights refresh to re-read. No observation
 * rebuild: callers batch that. */
async function extractAndStoreDay(input: ExtractorPromptInput): Promise<ExtractionResult> {
  inFlight.add(input.date);
  try {
    const ctx = await extractionContext(input.date);
    const fullInput: ExtractorPromptInput = {
      ...input,
      knownNames: ctx.knownNames,
      dismissedHabits: ctx.dismissedHabits,
      checkIn: formatCheckInForPrompt(ctx.checkIn),
    };

    let result: ExtractionResult;
    try {
      const [provider, budget] = await Promise.all([getProvider(), contextBudget()]);
      result =
        budget.mode === "compact"
          ? await extractCompact(provider, fullInput, budget.totalTokens)
          : await extractWithProvider(provider, fullInput);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.ok) {
      const x = applyCheckIn(groundExtraction(result.extraction, input.transcript, ctx.checkIn), ctx.checkIn);
      await upsertDayMetrics({
        date: input.date,
        mood: x.mood,
        energy: x.energy,
        summaryLine: x.summary_line,
        rawJson: JSON.stringify(x),
      });
    } else {
      await upsertDayMetrics({
        date: input.date,
        mood: ctx.checkIn?.mood ?? null,
        energy: ctx.checkIn?.energy ?? null,
        summaryLine: null,
        rawJson: "{}",
      });
    }
    return result;
  } finally {
    inFlight.delete(input.date);
  }
}

/** Lets an open Insights page know its numbers changed. */
function notifyInsights(): void {
  emit("insights:updated").catch(() => {});
}

/**
 * Runs after an entry is saved. Extracts the day,
 * upserts day_metrics, and rebuilds observations. On double failure the day
 * is stored with null metrics — extraction never blocks or
 * loses a saved entry, so callers may fire-and-forget.
 */
export async function runDayExtraction(input: ExtractorPromptInput): Promise<ExtractionResult> {
  const result = await extractAndStoreDay(input);
  await rebuildObservations();
  notifyInsights();
  // A new day can complete a week (a Sunday entry) or make a review stale —
  // check now instead of waiting up to 30 minutes for the scheduler.
  void runReviewJobsAndNotify({ whenIdle: true }).catch(() => {});
  return result;
}

/** A stored entry + its session's messages, in the shape the extractor takes.
 * Highlights are stored as a JSON string; anything unreadable becomes []. */
export function entryToExtractorInput(
  entry: Pick<Entry, "date" | "title" | "narrative" | "highlights" | "counselor_note">,
  messages: Pick<Message, "role" | "content">[],
): ExtractorPromptInput {
  let highlights: string[] = [];
  try {
    const parsed: unknown = JSON.parse(entry.highlights || "[]");
    if (Array.isArray(parsed)) highlights = parsed.filter((h): h is string => typeof h === "string");
  } catch {
    // keep []
  }
  return {
    date: entry.date,
    entry: {
      title: entry.title,
      narrative: entry.narrative,
      highlights,
      counselorNote: entry.counselor_note,
    },
    transcript: messages.map((m) => ({ role: m.role, content: m.content })),
  };
}

export interface ExtractionRepair {
  attempted: number;
  failed: number;
  /** Not tried, because the run stopped early after repeated failures. */
  skipped: number;
}

/**
 * The Insights refresh: re-reads every saved entry whose extraction failed or
 * never ran. Without this, such a day is missing from every chart for good.
 */
export async function retryMissingExtractions(
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractionRepair> {
  return extractEntries(await listEntriesNeedingExtraction(), onProgress);
}

/**
 * "Re-analyse all": re-reads every saved entry with the current extractor —
 * how older days pick up reused names, the user's own feeling words and the
 * clarified sleep field. The entries themselves are never touched; only
 * their analysis (day_metrics) is replaced. One model call or two per entry.
 */
export async function reanalyseAllEntries(
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractionRepair> {
  const all = (await listEntries()).slice().sort((a, b) => a.date.localeCompare(b.date));
  return extractEntries(all, onProgress);
}

/**
 * One entry at a time. Stops after two failures in a row — that almost always
 * means the provider itself is down or misconfigured, so the rest would fail
 * too and each one costs two model calls.
 */
async function extractEntries(
  entries: Entry[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractionRepair> {
  const pending = entries.filter((e) => !inFlight.has(e.date));
  let attempted = 0;
  let failed = 0;
  let failuresInARow = 0;

  for (const entry of pending) {
    if (failuresInARow >= 2) break;
    onProgress?.(attempted, pending.length);
    const messages = await listMessages(entry.session_id);
    const result = await extractAndStoreDay(entryToExtractorInput(entry, messages));
    attempted++;
    if (result.ok) {
      failuresInARow = 0;
    } else {
      failed++;
      failuresInARow++;
    }
  }

  if (attempted > 0) {
    await rebuildObservations();
    notifyInsights();
  }
  return { attempted, failed, skipped: pending.length - attempted };
}
