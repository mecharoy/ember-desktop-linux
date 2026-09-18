// Sleep, from the sleep diary on the check-in — the same
// few questions insomnia therapy (CBT-I) asks people to note each morning:
// when you got into bed, when you got up, how long it took to fall asleep,
// and how well you slept. Pure; unit-tested in sleep.test.ts.

import type { CheckIn } from "../db/types";
import type { DayRow } from "./stats";
import { addDays, avgOf, MIN_GAP, MIN_SIDE } from "./stats";

export type DiaryRow = Pick<CheckIn, "date" | "bedtime" | "wake_time" | "sleep_hours" | "sleep_latency_min" | "sleep_quality">;

/** "07:30" → 450. Anything else → null. */
export function parseClock(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** A bedtime after midnight still belongs to the night before: 00:30 → 24:30,
 *  so 23:30 and 00:30 average to midnight instead of to noon. */
export function nightMinutes(clock: number): number {
  return clock < 12 * 60 ? clock + 24 * 60 : clock;
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Standard deviation — how far a typical night sits from the usual. */
export function spread(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = avgOf(values)!;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export interface Night {
  date: string;
  bed: number | null; // night minutes
  wake: number | null; // clock minutes
  inBedMin: number | null;
  asleepMin: number | null;
  /** Asleep ÷ time in bed; only when hours slept and both times were given. */
  efficiency: number | null;
  latencyMin: number | null;
  quality: number | null;
}

export function nightFrom(row: DiaryRow): Night {
  const bedClock = parseClock(row.bedtime);
  const wake = parseClock(row.wake_time);
  const bed = bedClock === null ? null : nightMinutes(bedClock);
  // Wake is the morning after: measured from the previous midnight, +24h.
  let inBedMin = bed !== null && wake !== null ? wake + 24 * 60 - bed : null;
  if (inBedMin !== null && (inBedMin < 60 || inBedMin > 16 * 60)) inBedMin = null;
  const latencyMin = row.sleep_latency_min ?? null;
  const asleepMin =
    row.sleep_hours !== null ? row.sleep_hours * 60 : inBedMin !== null && latencyMin !== null ? inBedMin - latencyMin : null;
  const efficiency =
    row.sleep_hours !== null && inBedMin !== null ? Math.min(1, (row.sleep_hours * 60) / inBedMin) : null;
  return { date: row.date, bed, wake, inBedMin, asleepMin, efficiency, latencyMin, quality: row.sleep_quality ?? null };
}

function hasDiary(r: DiaryRow): boolean {
  return Boolean(r.bedtime || r.wake_time) || r.sleep_latency_min !== null || r.sleep_quality !== null;
}

export const SLEEP_WINDOW_DAYS = 28;
/** Nights with both times noted before the module opens. */
export const SLEEP_MIN_NIGHTS = 7;
/** The time-to-fall-asleep that sleep research treats as long. */
const LONG_LATENCY_MIN = 30;
/** The share of time in bed spent asleep that CBT-I aims for. */
const EFFICIENCY_TARGET = 0.85;

export interface SleepFinding {
  sentence: string;
  dates: string[];
}

export interface SleepSummary {
  nights: number;
  timedNights: number;
  avgAsleepH: number | null;
  usualBed: string | null;
  bedSpreadMin: number | null;
  usualWake: string | null;
  wakeSpreadMin: number | null;
  avgLatencyMin: number | null;
  avgQuality: number | null;
  avgEfficiency: number | null;
  findings: SleepFinding[];
}

export function countTimedNights(diary: DiaryRow[]): number {
  return diary.map(nightFrom).filter((n) => n.bed !== null && n.wake !== null).length;
}

/** The last SLEEP_WINDOW_DAYS for the numbers; all history for the one
 *  finding that needs a sample big enough to compare. */
export function sleepSummary(diary: DiaryRow[], rows: DayRow[], todayKey: string): SleepSummary {
  const since = addDays(todayKey, -SLEEP_WINDOW_DAYS);
  const nights = diary.filter((r) => r.date > since && r.date <= todayKey && hasDiary(r)).map(nightFrom);
  const timed = nights.filter((n) => n.bed !== null && n.wake !== null);
  const beds = nights.map((n) => n.bed).filter((v): v is number => v !== null);
  const wakes = nights.map((n) => n.wake).filter((v): v is number => v !== null);
  const latencies = nights.filter((n) => n.latencyMin !== null);
  const efficiencies = nights.filter((n) => n.efficiency !== null);
  const asleep = nights.map((n) => n.asleepMin).filter((v): v is number => v !== null);
  const avgBed = avgOf(beds);
  const avgWake = avgOf(wakes);
  const bedSpreadMin = spread(beds);

  const findings: SleepFinding[] = [];

  const long = latencies.filter((n) => n.latencyMin! >= LONG_LATENCY_MIN);
  if (latencies.length >= 6 && long.length / latencies.length >= 0.5) {
    findings.push({
      sentence: `It took ${LONG_LATENCY_MIN} minutes or more to fall asleep on ${long.length} of the ${latencies.length} nights you noted. If that keeps up most nights, it's worth mentioning to a doctor.`,
      dates: long.map((n) => n.date),
    });
  }

  const avgEfficiency = avgOf(efficiencies.map((n) => n.efficiency!));
  if (efficiencies.length >= 5 && avgEfficiency !== null && avgEfficiency < EFFICIENCY_TARGET) {
    findings.push({
      sentence: `You were asleep for about ${Math.round(avgEfficiency * 100)}% of your time in bed. Sleep therapy (CBT-I) aims for ${Math.round(EFFICIENCY_TARGET * 100)}% or more.`,
      dates: efficiencies.map((n) => n.date),
    });
  }

  if (timed.length >= SLEEP_MIN_NIGHTS && bedSpreadMin !== null && bedSpreadMin >= 60) {
    findings.push({
      sentence: `Your bedtime moves around by about ±${Math.round(bedSpreadMin)} minutes from night to night. A steadier bedtime is one of the first things sleep therapy works on.`,
      dates: timed.map((n) => n.date),
    });
  }

  // Sleep quality against that day's mood, over all history.
  const moodByDate = new Map(rows.filter((r) => r.mood !== null).map((r) => [r.date, r.mood!]));
  const rated = diary
    .filter((r) => r.sleep_quality !== null && moodByDate.has(r.date))
    .map((r) => ({ date: r.date, quality: r.sleep_quality!, mood: moodByDate.get(r.date)! }));
  const good = rated.filter((r) => r.quality >= 4);
  const poor = rated.filter((r) => r.quality <= 2);
  if (good.length >= MIN_SIDE && poor.length >= MIN_SIDE) {
    const g = avgOf(good.map((r) => r.mood))!;
    const p = avgOf(poor.map((r) => r.mood))!;
    if (g - p >= MIN_GAP) {
      findings.push({
        sentence: `After nights you rated 4 or 5, mood averages ${g.toFixed(1)}; after nights rated 1 or 2, ${p.toFixed(1)} (n=${good.length}/${poor.length}).`,
        dates: poor.map((r) => r.date),
      });
    }
  }

  return {
    nights: nights.length,
    timedNights: timed.length,
    avgAsleepH: asleep.length > 0 ? avgOf(asleep)! / 60 : null,
    usualBed: avgBed === null ? null : formatClock(avgBed),
    bedSpreadMin,
    usualWake: avgWake === null ? null : formatClock(avgWake),
    wakeSpreadMin: spread(wakes),
    avgLatencyMin: avgOf(latencies.map((n) => n.latencyMin!)),
    avgQuality: avgOf(nights.map((n) => n.quality).filter((v): v is number => v !== null)),
    avgEfficiency,
    findings,
  };
}
