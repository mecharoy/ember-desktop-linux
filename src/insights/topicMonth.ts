// One theme or person across one calendar month, a day at a time: on which
// days it came up, and how mood went alongside. Pure; unit-tested in
// topicMonth.test.ts.

import { canon, type DayRow } from "./stats";

export type TopicGroup = "themes" | "people";

export interface TopicDay {
  date: string;
  day: number;
  /** A journal entry exists for the day. */
  journaled: boolean;
  /** The name came up that day. */
  mentioned: boolean;
  /** How the entry felt about it, -1 to 1, when it came up. */
  sentiment: number | null;
  mood: number | null;
  summary: string | null;
}

/** "2026-09" → the number of days in that month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Every day of `month` (YYYY-MM), up to and including today when it is the
 *  current month. */
export function topicMonth(rows: DayRow[], group: TopicGroup, key: string, month: string, todayKey: string): TopicDay[] {
  const wanted = canon(key);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const last = month === todayKey.slice(0, 7) ? Number(todayKey.slice(8, 10)) : daysInMonth(month);
  const days: TopicDay[] = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const row = byDate.get(date);
    const hits = row ? row.x[group].filter((i) => canon(i.key) === wanted) : [];
    const sentiments = hits.map((h) => h.sentiment).filter((s): s is number => typeof s === "number");
    days.push({
      date,
      day: d,
      journaled: Boolean(row),
      mentioned: hits.length > 0,
      sentiment: sentiments.length > 0 ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null,
      mood: row?.mood ?? null,
      summary: row?.summaryLine ?? null,
    });
  }
  return days;
}
