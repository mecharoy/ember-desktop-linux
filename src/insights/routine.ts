// Daily routine, after the Social Rhythm Metric (SRM-5)
// used in interpersonal and social rhythm therapy: how regular five daily
// anchors are — getting up, first contact with another person, starting work
// or study, dinner, going to bed. Irregular routines and unsteady mood tend
// to go together. Pure; unit-tested in routine.test.ts.
//
// Scoring follows the SRM-5: within one week, an anchor that happened on at
// least 3 days has a usual time (its average); each day within 45 minutes of
// that is a "hit". The week's score is hits ÷ anchors counted, 0 to 7 — "on
// about N days of the week, the routine held".

import type { DayRow } from "./stats";
import { addDays, avgOf, mondayOf, MIN_GAP } from "./stats";
import { formatClock, nightMinutes, parseClock, type DiaryRow } from "./sleep";

export const HIT_WINDOW_MIN = 45;
const MIN_DAYS_PER_ANCHOR = 3;

export type AnchorId = "wake" | "first_contact" | "work_start" | "dinner" | "bed";

export const ANCHORS: { id: AnchorId; label: string }[] = [
  { id: "wake", label: "Getting up" },
  { id: "first_contact", label: "First contact with someone" },
  { id: "work_start", label: "Starting work or study" },
  { id: "dinner", label: "Dinner" },
  { id: "bed", label: "Going to bed" },
];

/** Every anchor time for one day, in minutes (bedtime on the night scale). */
export function anchorTimes(date: string, row: DayRow | undefined, diaryByDate: Map<string, DiaryRow>): Partial<Record<AnchorId, number>> {
  const out: Partial<Record<AnchorId, number>> = {};
  const wake = parseClock(diaryByDate.get(date)?.wake_time);
  if (wake !== null) out.wake = wake;
  // The bedtime noted on tomorrow's check-in is tonight's.
  const bed = parseClock(diaryByDate.get(addDays(date, 1))?.bedtime);
  if (bed !== null) out.bed = nightMinutes(bed);
  const fc = parseClock(row?.x.rhythm.firstContact);
  if (fc !== null) out.first_contact = fc;
  const ws = parseClock(row?.x.rhythm.workStart);
  if (ws !== null) out.work_start = ws;
  const dn = parseClock(row?.x.rhythm.dinner);
  if (dn !== null) out.dinner = dn;
  return out;
}

export interface RoutineWeek {
  weekStart: string;
  /** 0-7, or null when no anchor happened on 3+ days that week. */
  score: number | null;
  anchorsCounted: number;
  avgMood: number | null;
  moodDays: number;
}

export interface AnchorStat {
  id: AnchorId;
  label: string;
  usual: string | null;
  days: number;
  hits: number;
}

export interface RoutineSummary {
  weeks: RoutineWeek[];
  latest: RoutineWeek | null;
  /** Over the last 28 days. */
  anchors: AnchorStat[];
  finding: { sentence: string; dates: string[] } | null;
}

function hitsAround(times: number[]): { usual: number; hits: number } {
  const usual = avgOf(times)!;
  return { usual, hits: times.filter((t) => Math.abs(t - usual) <= HIT_WINDOW_MIN).length };
}

export function weekScore(dates: string[], rowsByDate: Map<string, DayRow>, diaryByDate: Map<string, DiaryRow>): { score: number | null; anchorsCounted: number } {
  const perAnchor = new Map<AnchorId, number[]>();
  for (const d of dates) {
    const times = anchorTimes(d, rowsByDate.get(d), diaryByDate);
    for (const [id, t] of Object.entries(times) as [AnchorId, number][]) {
      perAnchor.set(id, [...(perAnchor.get(id) ?? []), t]);
    }
  }
  let hits = 0;
  let counted = 0;
  for (const times of perAnchor.values()) {
    if (times.length < MIN_DAYS_PER_ANCHOR) continue;
    counted++;
    hits += hitsAround(times).hits;
  }
  return { score: counted === 0 ? null : hits / counted, anchorsCounted: counted };
}

export function routineSummary(rows: DayRow[], diary: DiaryRow[], todayKey: string, weeksBack = 12): RoutineSummary {
  const rowsByDate = new Map(rows.map((r) => [r.date, r]));
  const diaryByDate = new Map(diary.map((d) => [d.date, d]));

  const thisMonday = mondayOf(todayKey);
  const weeks: RoutineWeek[] = [];
  for (let i = weeksBack; i >= 1; i--) {
    const weekStart = addDays(thisMonday, -7 * i);
    const dates = Array.from({ length: 7 }, (_, k) => addDays(weekStart, k));
    const { score, anchorsCounted } = weekScore(dates, rowsByDate, diaryByDate);
    const moods = dates.map((d) => rowsByDate.get(d)?.mood).filter((m): m is number => m !== null && m !== undefined);
    weeks.push({ weekStart, score, anchorsCounted, avgMood: avgOf(moods), moodDays: moods.length });
  }
  const scored = weeks.filter((w) => w.score !== null);

  const since = addDays(todayKey, -28);
  const recentDates = Array.from({ length: 28 }, (_, k) => addDays(since, k + 1)).filter((d) => d < todayKey);
  const anchors: AnchorStat[] = ANCHORS.map(({ id, label }) => {
    const times = recentDates
      .map((d) => anchorTimes(d, rowsByDate.get(d), diaryByDate)[id])
      .filter((t): t is number => t !== undefined);
    if (times.length === 0) return { id, label, usual: null, days: 0, hits: 0 };
    const { usual, hits } = hitsAround(times);
    return { id, label, usual: formatClock(usual), days: times.length, hits };
  });

  // Steadier weeks against less steady ones: 6+ scored weeks with 3+ rated
  // days each, split at the median score.
  let finding: RoutineSummary["finding"] = null;
  const comparable = scored.filter((w) => w.avgMood !== null && w.moodDays >= 3);
  if (comparable.length >= 6) {
    const sorted = comparable.slice().sort((a, b) => b.score! - a.score!);
    const half = Math.floor(sorted.length / 2);
    const steady = sorted.slice(0, half);
    const unsteady = sorted.slice(sorted.length - half);
    const s = avgOf(steady.map((w) => w.avgMood!))!;
    const u = avgOf(unsteady.map((w) => w.avgMood!))!;
    if (Math.abs(s - u) >= MIN_GAP) {
      finding = {
        sentence: `In your steadier weeks, mood averaged ${s.toFixed(1)}; in the least regular ones, ${u.toFixed(1)} (${half} weeks each).`,
        dates: steady.flatMap((w) => Array.from({ length: 7 }, (_, k) => addDays(w.weekStart, k))).filter((d) => rowsByDate.has(d)),
      };
    }
  }

  return { weeks, latest: scored[scored.length - 1] ?? null, anchors, finding };
}
