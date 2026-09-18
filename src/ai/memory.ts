// Pure helpers that turn stored memory rows into the compact context layers
// the counselor reads. No db imports — unit-tested directly; the
// fetching happens in context.ts.

import type { DayMetrics, Observation } from "../db/types";

function sentimentWord(s: number | null): string | null {
  if (s === null) return null;
  if (s > 0.15) return "positive";
  if (s < -0.15) return "negative";
  return "mixed";
}

/** One observation as a context line, e.g. `habit:gym — 12×, last 2026-07-04, positive`. */
export function formatObservationLine(o: Observation): string {
  const parts = [`${o.occurrences}×`, `last ${o.last_seen}`];
  const word = sentimentWord(o.sentiment);
  if (word) parts.push(word);
  return `${o.kind}:${o.key} — ${parts.join(", ")}`;
}

export function formatTopObservations(observations: Observation[]): string {
  if (observations.length === 0) return "(none recorded yet)";
  return observations.map((o) => `- ${formatObservationLine(o)}`).join("\n");
}

// The rotating day-audit domains that extraction can
// actually detect evidence for. Timeline/mood/wins are mandatory every
// session, so they never appear here.
const ROTATING_DOMAINS: { label: string; coveredBy: (x: Record<string, unknown>) => boolean }[] = [
  {
    label: "body (sleep, food, movement)",
    coveredBy: (x) => typeof x.sleep_hours === "number",
  },
  {
    label: "people (who they interacted with)",
    coveredBy: (x) => Array.isArray(x.people) && x.people.length > 0,
  },
  {
    label: "worries & loose ends",
    coveredBy: (x) => Array.isArray(x.struggles_shown) && x.struggles_shown.length > 0,
  },
];

/**
 * Domains with no evidence in the last ~5 extracted days, computed from
 * observations/day_metrics. Empty when there's no history
 * yet — a brand-new user shouldn't be probed about "neglected" anything.
 */
export function computeNeglectedDomains(recentMetrics: Pick<DayMetrics, "raw_json">[]): string[] {
  if (recentMetrics.length === 0) return [];
  const parsed = recentMetrics.map((m) => {
    try {
      const x = JSON.parse(m.raw_json);
      return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
    } catch {
      return {} as Record<string, unknown>;
    }
  });
  return ROTATING_DOMAINS.filter((d) => !parsed.some((x) => d.coveredBy(x))).map((d) => d.label);
}

/**
 * Open threads = recent struggles the user may still be carrying: seen within
 * the last `days`, newest first, at most `max`.
 */
export function selectOpenThreads(
  observations: Observation[],
  todayKey: string,
  { days = 7, max = 3 }: { days?: number; max?: number } = {},
): Observation[] {
  const msPerDay = 24 * 60 * 60 * 1000;
  const cutoff = Date.parse(todayKey) - days * msPerDay;
  return observations
    .filter((o) => o.kind === "struggle" && Date.parse(o.last_seen) >= cutoff)
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
    .slice(0, max);
}

export function formatOpenThreads(threads: Observation[]): string {
  if (threads.length === 0) return "(none)";
  return threads.map((t) => `- ${t.key} (last came up ${t.last_seen})`).join("\n");
}
