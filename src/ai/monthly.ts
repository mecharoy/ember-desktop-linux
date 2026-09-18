// Monthly report job. Runs once a month is over: the app
// computes the numbers (insights/stats.ts monthStats), the model writes a
// short letter and one "what changed" sentence around them.

import { z } from "zod";
import { contextBudget } from "./budget";
import { compactDayLine } from "./compactDays";
import { getProvider } from "./factory";
import { extractJson } from "./json";
import { JOB_REPLY_TOKENS } from "./replySizes";
import {
  MONTHLY_SYSTEM_PROMPT,
  buildMonthlyUserPrompt,
  type MonthlyPromptInput,
} from "./prompts/monthly";
import { sourceDaysKey } from "./review";
import { localDateKey } from "../time";
import { listAllDayMetrics } from "../db/metrics";
import { listMonthlyReports, saveMonthlyReport } from "../db/reviews";
import { getSetting } from "../db/settings";
import { monthStats, parseDayRows } from "../insights/stats";
import { listAssessments } from "../db/assessments";
import type { AIProvider } from "./types";

// The "5 Ps" — how clinicians sum up what is going on for someone. Every
// point must name the days it rests on; ungrounded points are dropped in code.
const FormulationPoint = z.object({ point: z.string().min(1), dates: z.array(z.string()).default([]) });
export const FORMULATION_KEYS = ["presenting", "predisposing", "precipitating", "perpetuating", "protective"] as const;
export type FormulationKey = (typeof FORMULATION_KEYS)[number];

export const FormulationSchema = z.object({
  presenting: z.array(FormulationPoint).catch([]),
  predisposing: z.array(FormulationPoint).catch([]),
  precipitating: z.array(FormulationPoint).catch([]),
  perpetuating: z.array(FormulationPoint).catch([]),
  protective: z.array(FormulationPoint).catch([]),
});
export type Formulation = z.infer<typeof FormulationSchema>;

const EMPTY_FORMULATION: Formulation = {
  presenting: [],
  predisposing: [],
  precipitating: [],
  perpetuating: [],
  protective: [],
};

export const MonthlyReportSchema = z.object({
  letter: z.string().min(1),
  changed: z.string().min(1),
  // Falls back rather than failing: a report without a formulation is still
  // a report, and older models may not manage the extra structure.
  formulation: FormulationSchema.catch(EMPTY_FORMULATION),
});

/** At most this many points per P — a formulation is a summary, not a list. */
export const MAX_POINTS_PER_P = 4;

/**
 * Holds the formulation to the month: dates outside the days the report was
 * written from are removed, and a point left with no date is dropped — so
 * every point shown links to real entries. Pure.
 */
export function groundFormulation(f: Formulation, monthDays: string[]): Formulation {
  const valid = new Set(monthDays);
  const out = { ...EMPTY_FORMULATION };
  for (const key of FORMULATION_KEYS) {
    out[key] = f[key]
      .map((p) => ({ point: p.point.trim(), dates: Array.from(new Set(p.dates.filter((d) => valid.has(d)))).sort() }))
      .filter((p) => p.point.length > 0 && p.dates.length > 0)
      .slice(0, MAX_POINTS_PER_P);
  }
  return out;
}

export function parseFormulation(json: string | null): Formulation | null {
  if (!json) return null;
  try {
    const f = FormulationSchema.parse(JSON.parse(json));
    return FORMULATION_KEYS.some((k) => f[k].length > 0) ? f : null;
  } catch {
    return null;
  }
}

export type MonthlyResult =
  | { ok: true; report: z.infer<typeof MonthlyReportSchema> }
  | { ok: false; error: string };

/** Validated + retried-once; provider injected for tests. */
export async function monthlyWithProvider(
  provider: AIProvider,
  input: MonthlyPromptInput,
): Promise<MonthlyResult> {
  const basePrompt = buildMonthlyUserPrompt(input);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response could not be parsed as valid JSON matching the required shape: ${lastError}\nReturn ONLY the corrected JSON object, nothing else.`;
    try {
      const raw = await provider.complete([{ role: "user", content: prompt }], MONTHLY_SYSTEM_PROMPT, {
        maxTokens: JOB_REPLY_TOKENS.monthly,
      });
      return { ok: true, report: MonthlyReportSchema.parse(extractJson(raw)) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

/** "2026-09" → "2026-08" (and January → the previous December). */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The oldest month that needs a report: it is over (before today's month),
 * has extracted days, and has no report yet or its days changed since the
 * report was written. One per call, like the weekly job. Null when none.
 */
export function dueReportMonth(
  todayKey: string,
  metricDates: string[],
  existing: { month: string; sourceDays: string }[],
): string | null {
  const current = todayKey.slice(0, 7);
  const months = Array.from(new Set(metricDates.map((d) => d.slice(0, 7))))
    .filter((m) => m < current)
    .sort();
  const byMonth = new Map(existing.map((r) => [r.month, r.sourceDays]));
  for (const m of months) {
    const days = sourceDaysKey(metricDates.filter((d) => d.startsWith(m)));
    if (byMonth.get(m) !== days) return m;
  }
  return null;
}

let running: Promise<MonthlyResult | null> | null = null;

/** Joins a run already in progress instead of paying for the same report twice. */
export function runMonthlyReportIfDue(): Promise<MonthlyResult | null> {
  if (!running) {
    running = runOnce().finally(() => {
      running = null;
    });
  }
  return running;
}

async function runOnce(): Promise<MonthlyResult | null> {
  const [metrics, reports, assessments] = await Promise.all([listAllDayMetrics(), listMonthlyReports(), listAssessments()]);
  const month = dueReportMonth(
    localDateKey(),
    metrics.map((m) => m.date),
    reports.map((r) => ({ month: r.month, sourceDays: r.source_days })),
  );
  if (!month) return null;

  const rows = parseDayRows(metrics);
  const stats = monthStats(rows, month);
  const prev = previousMonth(month);
  const days = metrics.filter((m) => m.date.startsWith(month));

  const compact = (await contextBudget()).mode === "compact";
  let result: MonthlyResult;
  try {
    result = await monthlyWithProvider(await getProvider(), {
      userName: (await getSetting("user_name")).trim(),
      stats,
      previous: rows.some((r) => r.date.startsWith(prev)) ? monthStats(rows, prev) : null,
      days: days.map((m) => ({ date: m.date, rawJson: compact ? compactDayLine(m.raw_json) : m.raw_json })),
      assessments: assessments.filter((a) => a.date.startsWith(month)),
    });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (result.ok) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    await saveMonthlyReport({
      month,
      letter: result.report.letter,
      changed: result.report.changed,
      stats: JSON.stringify(stats),
      formulation: JSON.stringify(groundFormulation(result.report.formulation, days.map((d) => d.date))),
      sourceDays: sourceDaysKey(days.map((d) => d.date)),
      createdAt: `${localDateKey(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    });
  }
  return result;
}
