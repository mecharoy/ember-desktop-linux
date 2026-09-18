// Pure observation-aggregation math (no db imports — unit-tested directly).
//
// Observations are DERIVED state: rather than incrementally mutating rows on
// every extraction (which would double-count whenever a day's entry is
// regenerated and re-extracted), the observations table is rebuilt from all
// day_metrics.raw_json rows after each extraction. day_metrics.date is
// UNIQUE, so each day contributes exactly once no matter how many times it
// was re-saved. 5: "canonicalize keys case-insensitively".

import type { Observation } from "./types";

export interface MetricsRow {
  date: string; // YYYY-MM-DD
  raw_json: string;
}

export type ObservationAggregate = Omit<Observation, "id" | "pinned" | "detail">;

interface DayEvent {
  kind: Observation["kind"];
  key: string;
  sentiment: number | null;
}

/** Case-insensitive canonical identity for an observation key. */
export function canonicalKey(key: string): string {
  return key.trim().toLowerCase();
}

function eventsFromRawJson(raw: string): DayEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const x = parsed as Record<string, unknown>;
  const events: DayEvent[] = [];

  const push = (kind: Observation["kind"], key: unknown, sentiment: unknown = null) => {
    if (typeof key !== "string" || key.trim().length === 0) return;
    events.push({
      kind,
      key: key.trim(),
      sentiment: typeof sentiment === "number" && Number.isFinite(sentiment) ? sentiment : null,
    });
  };

  if (Array.isArray(x.themes)) {
    for (const t of x.themes as Record<string, unknown>[]) push("theme", t?.key, t?.sentiment);
  }
  if (Array.isArray(x.habits)) {
    // A habit counts as an occurrence only on days it was actually done; the
    // per-day done/missed detail stays in raw_json for the habit calendar.
    for (const h of x.habits as Record<string, unknown>[]) {
      if (h?.done === true) push("habit", h?.key);
    }
  }
  if (Array.isArray(x.people)) {
    for (const p of x.people as Record<string, unknown>[]) push("person", p?.key, p?.sentiment);
  }
  if (Array.isArray(x.strengths_shown)) {
    for (const s of x.strengths_shown) push("strength", s);
  }
  if (Array.isArray(x.struggles_shown)) {
    for (const s of x.struggles_shown) push("struggle", s);
  }
  return events;
}

/**
 * Folds every day's extraction into one aggregate per (kind, canonical key):
 * occurrences = number of days it appeared, sentiment = mean of the non-null
 * per-day sentiments, first/last_seen = date range, key = first-seen casing.
 */
export function foldMetricsIntoObservations(rows: MetricsRow[]): ObservationAggregate[] {
  const byIdentity = new Map<
    string,
    ObservationAggregate & { sentimentSum: number; sentimentCount: number }
  >();

  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sorted) {
    // The same key can appear once per day at most — a day mentioning the
    // same theme twice in raw_json still counts as one occurrence.
    const seenToday = new Set<string>();
    for (const ev of eventsFromRawJson(row.raw_json)) {
      const identity = `${ev.kind}\u0000${canonicalKey(ev.key)}`;
      let agg = byIdentity.get(identity);
      if (!agg) {
        agg = {
          kind: ev.kind,
          key: ev.key,
          sentiment: null,
          occurrences: 0,
          first_seen: row.date,
          last_seen: row.date,
          sentimentSum: 0,
          sentimentCount: 0,
        };
        byIdentity.set(identity, agg);
      }
      if (!seenToday.has(identity)) {
        seenToday.add(identity);
        agg.occurrences += 1;
        agg.last_seen = row.date;
      }
      if (ev.sentiment !== null) {
        agg.sentimentSum += ev.sentiment;
        agg.sentimentCount += 1;
      }
    }
  }

  return Array.from(byIdentity.values()).map(({ sentimentSum, sentimentCount, ...agg }) => ({
    ...agg,
    sentiment: sentimentCount > 0 ? sentimentSum / sentimentCount : null,
  }));
}

/**
 * Ranking score for the counselor context (3: "ranked by
 * recency × occurrences") — occurrences damped by how long ago the
 * observation last appeared, with a one-week half-life-ish decay.
 */
export function observationScore(
  o: Pick<Observation, "occurrences" | "last_seen">,
  todayKey: string,
): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSince = Math.max(
    0,
    Math.round((Date.parse(todayKey) - Date.parse(o.last_seen)) / msPerDay),
  );
  return o.occurrences / (1 + daysSince / 7);
}
