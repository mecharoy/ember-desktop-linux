// Activities & mood, after behavioural activation — a
// first-line talking treatment for depression built on one observation:
// doing things that give enjoyment or a sense of achievement lifts mood, and
// dropping them lets it sink further. Pure; unit-tested in activation.test.ts.
//
// Enjoyment ("pleasure") and achievement ("mastery") are each 0-3, read from
// how the user described the activity, or null when their words don't say.
// That makes them the AI's reading, which the module says out loud.

import type { DayRow } from "./stats";
import { addDays, avgOf, canon, MIN_GAP, MIN_SIDE } from "./stats";

export interface ActivityStat {
  key: string;
  days: number;
  /** Mean enjoyment over the days it was rated, with how many that is. */
  pleasure: { avg: number; n: number } | null;
  mastery: { avg: number; n: number } | null;
  /** Same bar as What moves your mood: 10 days a side and a 0.8 gap. */
  moodEffect: { withAvg: number; withoutAvg: number; nWith: number; nWithout: number } | null;
  /** The plain comparison shown in the table: from 3 days a side, whatever the
   *  gap. `moodEffect` above is the same numbers once they clear the higher bar. */
  moodOn: { withAvg: number; withoutAvg: number; nWith: number; nWithout: number } | null;
  dates: string[];
}

/** Days with and without an activity needed before its mood is shown at all. */
export const MOOD_ON_MIN_DAYS = 3;

function rated(values: (number | null)[]): { avg: number; n: number } | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : { avg: avgOf(nums)!, n: nums.length };
}

/** Most frequent first; activities seen on fewer than 2 days are left out. */
export function activityStats(rows: DayRow[]): ActivityStat[] {
  const map = new Map<string, { key: string; dates: Set<string>; pleasure: (number | null)[]; mastery: (number | null)[] }>();
  for (const r of rows) {
    for (const a of r.x.activities) {
      const c = canon(a.key);
      if (!c) continue;
      const agg = map.get(c) ?? { key: a.key.trim(), dates: new Set<string>(), pleasure: [], mastery: [] };
      if (!agg.dates.has(r.date)) {
        agg.dates.add(r.date);
        agg.pleasure.push(a.pleasure);
        agg.mastery.push(a.mastery);
      }
      map.set(c, agg);
    }
  }

  const tracked = rows.filter((r) => r.mood !== null);
  return Array.from(map.entries())
    .filter(([, agg]) => agg.dates.size >= 2)
    .map(([c, agg]) => {
      const has = (r: DayRow) => r.x.activities.some((a) => canon(a.key) === c);
      const withDays = tracked.filter(has);
      const withoutDays = tracked.filter((r) => !has(r));
      let moodEffect: ActivityStat["moodEffect"] = null;
      let moodOn: ActivityStat["moodOn"] = null;
      if (withDays.length >= MOOD_ON_MIN_DAYS && withoutDays.length >= MOOD_ON_MIN_DAYS) {
        const withAvg = avgOf(withDays.map((r) => r.mood!))!;
        const withoutAvg = avgOf(withoutDays.map((r) => r.mood!))!;
        moodOn = { withAvg, withoutAvg, nWith: withDays.length, nWithout: withoutDays.length };
        if (withDays.length >= MIN_SIDE && withoutDays.length >= MIN_SIDE && Math.abs(withAvg - withoutAvg) >= MIN_GAP) {
          moodEffect = moodOn;
        }
      }
      const dates = Array.from(agg.dates).sort();
      return { key: agg.key, days: dates.length, pleasure: rated(agg.pleasure), mastery: rated(agg.mastery), moodEffect, moodOn, dates };
    })
    .sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
}

/** "Enjoyable" for the pull-back check: rated 2 or 3 for enjoyment. */
const ENJOYABLE = 2;

export interface PullBack {
  recentPerDay: number;
  beforePerDay: number;
  recentDays: number;
  beforeDays: number;
}

/** Each window needs at least this many journaled days to compare. */
export const PULLBACK_MIN_DAYS = 6;

/**
 * Enjoyable activities per journaled day: the last 14 days against the 28
 * before. Returned only for a clear drop — under 60% of before — since a
 * shrinking share of enjoyable things is what behavioural activation watches
 * for. Null when there isn't enough on either side, or no real drop.
 */
export function enjoymentPullBack(rows: DayRow[], todayKey: string): PullBack | null {
  const recentStart = addDays(todayKey, -14);
  const beforeStart = addDays(todayKey, -42);
  const count = (r: DayRow) => r.x.activities.filter((a) => (a.pleasure ?? -1) >= ENJOYABLE).length;
  const recent = rows.filter((r) => r.date >= recentStart && r.date < todayKey);
  const before = rows.filter((r) => r.date >= beforeStart && r.date < recentStart);
  if (recent.length < PULLBACK_MIN_DAYS || before.length < PULLBACK_MIN_DAYS) return null;
  const recentPerDay = recent.reduce((n, r) => n + count(r), 0) / recent.length;
  const beforePerDay = before.reduce((n, r) => n + count(r), 0) / before.length;
  if (beforePerDay < 0.5 || recentPerDay >= beforePerDay * 0.6) return null;
  return { recentPerDay, beforePerDay, recentDays: recent.length, beforeDays: before.length };
}

/** Known activity names, most used first, for the extractor's KNOWN NAMES. */
export function knownActivityNames(rows: DayRow[], limit = 40): string[] {
  const counts = new Map<string, { key: string; n: number }>();
  for (const r of rows) {
    for (const a of r.x.activities) {
      const c = canon(a.key);
      if (!c) continue;
      const e = counts.get(c) ?? { key: a.key.trim(), n: 0 };
      e.n++;
      counts.set(c, e);
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((e) => e.key);
}
