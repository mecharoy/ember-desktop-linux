// Grouping notes by the day they were dropped.
//
// Ember used to show, discuss and journal only the notes whose timestamp fell
// on today. Nothing was ever deleted, but a note written on Tuesday became
// invisible at midnight whether or not it had ever been turned into a journal
// entry — so a day you didn't get round to writing up was simply lost.
//
// Notes now carry forward until a journal entry covers them, which means any
// of these lists can span several days and has to say which day each note came
// from. This module is the one place that decides how a day is labelled, so
// the sidebar, the counselor prompt and the journal prompt all agree.

import type { Capture } from "./db/types";

export interface CaptureDay<T> {
  /** YYYY-MM-DD local. */
  dateKey: string;
  /** "Today", "Yesterday", or "Monday, 2026-07-07". */
  label: string;
  isToday: boolean;
  /** Oldest first — a day reads as a timeline. */
  captures: T[];
}

function dayKeyOf(createdAt: string): string {
  // created_at is already local wall-clock time (db/captures.ts isoNow), so
  // the first ten characters are the local date with no re-interpretation.
  return createdAt.slice(0, 10);
}

function shiftDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function labelForDay(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === shiftDays(todayKey, -1)) return "Yesterday";
  const weekday = new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}, ${dateKey}`;
}

/**
 * Buckets notes by local day, oldest day first, oldest note first inside each
 * day. Input order doesn't matter.
 */
export function groupCapturesByDay<T extends { created_at: string }>(
  captures: T[],
  todayKey: string,
): CaptureDay<T>[] {
  const byDay = new Map<string, T[]>();
  for (const capture of captures) {
    const key = dayKeyOf(capture.created_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(capture);
    else byDay.set(key, [capture]);
  }

  return [...byDay.keys()]
    .sort()
    .map((dateKey) => ({
      dateKey,
      label: labelForDay(dateKey, todayKey),
      isToday: dateKey === todayKey,
      captures: byDay
        .get(dateKey)!
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }));
}

function formatOne(c: Pick<Capture, "created_at" | "text" | "mood_emoji">): string {
  return `- ${c.created_at.slice(11, 16)}${c.mood_emoji ? ` ${c.mood_emoji}` : ""}: ${c.text}`;
}

/**
 * The same grouped list rendered for a model. Days older than today are
 * marked as still unwritten, so the model understands why it is being handed
 * a note from three days ago and doesn't treat it as something that happened
 * tonight.
 */
export function formatCaptureDaysForPrompt(
  captures: Pick<Capture, "created_at" | "text" | "mood_emoji">[],
  todayKey: string,
  emptyText = "(none yet today)",
): string {
  if (captures.length === 0) return emptyText;
  const grouped = groupCapturesByDay(captures, todayKey);
  // No reference day given (the journal writer can be called without one):
  // treat the most recent day present as the day being written, so its notes
  // aren't mislabelled as an unwritten older day.
  const days = todayKey
    ? grouped
    : groupCapturesByDay(captures, grouped[grouped.length - 1].dateKey);
  if (days.length === 1 && days[0].isToday) {
    return days[0].captures.map(formatOne).join("\n");
  }
  return days
    .map((day) => {
      const heading = day.isToday
        ? "Today:"
        : `${day.label} — no journal was written that day:`;
      return `${heading}\n${day.captures.map(formatOne).join("\n")}`;
    })
    .join("\n");
}
