import type { CheckIn } from "../db/types";
import { addDays, canonicalEmotion, type DayRow } from "./stats";

/**
 * The recap: a short slideshow of the last week or month, one fact per slide.
 * Built only from what is already on the device — the days, their check-ins,
 * and the suggestions the model already wrote for Patterns. No model call,
 * so it opens instantly, works offline, and cannot invent anything.
 *
 * A slide is left out when there is not enough behind it: an average of one
 * day, a "top theme" that came up once, is noise dressed up as a finding.
 */

export type RecapPeriod = "week" | "month";

export const PERIOD_DAYS: Record<RecapPeriod, number> = { week: 7, month: 30 };

export type Feel = "good" | "mixed" | "heavy";

export type Slide =
  | { kind: "open"; from: string; to: string; written: number; days: number }
  | { kind: "mood"; avg: number; prevAvg: number | null; energyAvg: number | null; series: (number | null)[] }
  | { kind: "bestDay"; date: string; title: string; line: string | null; mood: number }
  | { kind: "theme"; key: string; count: number; rest: { key: string; count: number }[] }
  | { kind: "people"; key: string; count: number; feel: Feel | null; rest: { key: string; count: number }[] }
  | { kind: "feelings"; words: { word: string; count: number }[]; own: boolean }
  | { kind: "lift"; activity: string; withAvg: number; withoutAvg: number; days: number }
  | { kind: "sleep"; avgHours: number; nights: number; bedtime: string | null }
  | { kind: "streak"; days: number }
  | { kind: "close"; notes: number; suggestion: string | null };

export interface RecapInput {
  period: RecapPeriod;
  today: string;
  rows: DayRow[];
  /** Saved entries: their date and title. */
  entries: { date: string; title: string }[];
  checkins: CheckIn[];
  /** created_at of every quick note, ISO local. */
  captureTimes: string[];
  streak: number;
  /** Suggestion titles the model already wrote for Patterns, if any. */
  suggestions: string[];
}

const MIN_RATED = 3;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function feelOf(sentiment: number | null): Feel | null {
  if (sentiment === null) return null;
  if (sentiment > 0.25) return "good";
  if (sentiment < -0.25) return "heavy";
  return "mixed";
}

/** Minutes after noon, so a 00:30 bedtime sorts after 23:30. */
function bedMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins < 12 * 60 ? mins + 24 * 60 : mins;
}

function clockOf(mins: number): string {
  const m = Math.round(mins) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function counted<T>(items: T[], keyOf: (t: T) => string): Map<string, { count: number; items: T[] }> {
  const map = new Map<string, { count: number; items: T[] }>();
  for (const it of items) {
    const k = keyOf(it);
    const slot = map.get(k) ?? { count: 0, items: [] };
    slot.count += 1;
    slot.items.push(it);
    map.set(k, slot);
  }
  return map;
}

export function buildRecap(input: RecapInput): Slide[] {
  const days = PERIOD_DAYS[input.period];
  const from = addDays(input.today, -(days - 1));
  const to = input.today;
  const inWindow = (d: string) => d >= from && d <= to;
  const rows = input.rows.filter((r) => inWindow(r.date));
  const titles = new Map(input.entries.map((e) => [e.date, e.title]));
  const written = input.entries.filter((e) => inWindow(e.date)).length;
  const slides: Slide[] = [{ kind: "open", from, to, written, days }];

  // Mood, against the same stretch before it.
  const rated = rows.filter((r) => r.mood !== null);
  if (rated.length >= MIN_RATED) {
    const prevFrom = addDays(from, -days);
    const prevTo = addDays(from, -1);
    const prev = input.rows.filter((r) => r.date >= prevFrom && r.date <= prevTo && r.mood !== null);
    const series: (number | null)[] = [];
    const byDate = new Map(rows.map((r) => [r.date, r.mood]));
    for (let i = 0; i < days; i++) series.push(byDate.get(addDays(from, i)) ?? null);
    const energies = rows.flatMap((r) => (r.energy === null ? [] : [r.energy]));
    slides.push({
      kind: "mood",
      avg: avg(rated.map((r) => r.mood as number)) as number,
      prevAvg: prev.length >= MIN_RATED ? avg(prev.map((r) => r.mood as number)) : null,
      energyAvg: energies.length >= MIN_RATED ? avg(energies) : null,
      series,
    });
  }

  // The best day: highest mood among days with an entry, the latest on a tie.
  const bestPool = rated.filter((r) => titles.has(r.date));
  if (bestPool.length >= 2) {
    const best = bestPool.reduce((a, b) => ((b.mood as number) >= (a.mood as number) ? b : a));
    slides.push({
      kind: "bestDay",
      date: best.date,
      title: titles.get(best.date) || "",
      line: best.summaryLine,
      mood: best.mood as number,
    });
  }

  // What came up most, and who.
  const themes = [...counted(rows.flatMap((r) => r.x.themes), (t) => t.key.trim().toLowerCase()).entries()]
    .map(([key, v]) => ({ key, count: v.count }))
    .sort((a, b) => b.count - a.count);
  if (themes.length > 0 && themes[0].count >= 2) {
    slides.push({ kind: "theme", key: themes[0].key, count: themes[0].count, rest: themes.slice(1, 4) });
  }

  const people = [...counted(rows.flatMap((r) => r.x.people), (p) => p.key.trim())]
    .map(([key, v]) => ({ key, count: v.count, sentiment: avg(v.items.map((p) => p.sentiment)) }))
    .sort((a, b) => b.count - a.count);
  if (people.length > 0 && people[0].count >= 2) {
    const top = people[0];
    slides.push({
      kind: "people",
      key: top.key,
      count: top.count,
      feel: feelOf(top.sentiment),
      rest: people.slice(1, 4).map(({ key, count }) => ({ key, count })),
    });
  }

  // Feelings: their own words when they gave any, otherwise Elytra's labels.
  const named = rows.flatMap((r) => r.x.emotionsNamed ?? []);
  const own = named.length > 0;
  const feelingWords = [...counted(own ? named : rows.flatMap((r) => r.x.emotions), canonicalEmotion)]
    .map(([word, v]) => ({ word, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  if (feelingWords.length > 0 && feelingWords[0].count >= 2) {
    slides.push({ kind: "feelings", words: feelingWords, own });
  }

  // What lifted them: the activity whose days ran highest against days without it.
  const activityKeys = new Set(rows.flatMap((r) => r.x.activities.map((a) => a.key.trim().toLowerCase())));
  let lift: Extract<Slide, { kind: "lift" }> | null = null;
  for (const key of activityKeys) {
    const has = (r: DayRow) => r.x.activities.some((a) => a.key.trim().toLowerCase() === key);
    const withDays = rated.filter(has);
    const without = rated.filter((r) => !has(r));
    if (withDays.length < 2 || without.length < 2) continue;
    const w = avg(withDays.map((r) => r.mood as number)) as number;
    const wo = avg(without.map((r) => r.mood as number)) as number;
    if (w - wo >= 0.3 && (!lift || w - wo > lift.withAvg - lift.withoutAvg)) {
      lift = { kind: "lift", activity: key, withAvg: w, withoutAvg: wo, days: withDays.length };
    }
  }
  if (lift) slides.push(lift);

  // Sleep, from the check-in diary.
  const nights = input.checkins.filter((c) => inWindow(c.date) && c.sleep_hours !== null);
  if (nights.length >= MIN_RATED) {
    const beds = input.checkins
      .filter((c) => inWindow(c.date) && c.bedtime)
      .map((c) => bedMinutes(c.bedtime as string))
      .filter((m): m is number => m !== null)
      .sort((a, b) => a - b);
    slides.push({
      kind: "sleep",
      avgHours: avg(nights.map((c) => c.sleep_hours as number)) as number,
      nights: nights.length,
      bedtime: beds.length >= MIN_RATED ? clockOf(beds[Math.floor(beds.length / 2)]) : null,
    });
  }

  if (input.streak >= 3) slides.push({ kind: "streak", days: input.streak });

  const notes = input.captureTimes.filter((t) => inWindow(t.slice(0, 10))).length;
  slides.push({ kind: "close", notes, suggestion: input.suggestions[0] ?? null });
  return slides;
}
