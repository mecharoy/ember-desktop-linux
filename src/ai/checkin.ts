// The evening check-in (db/checkins.ts) in the one shape the counselor,
// the journal writer and the extractor all read. Pure — unit-tested in
// checkin.test.ts.

import type { CheckIn } from "../db/types";

export interface CheckInSummary {
  mood: number | null;
  energy: number | null;
  sleepHours: number | null;
  feeling: string | null;
  onMind: string | null;
  habits: Record<string, boolean>; // pinned habit key → done today
  /** Sleep diary, the night before — each null when left blank. */
  bedtime: string | null;
  wakeTime: string | null;
  sleepLatencyMin: number | null;
  sleepQuality: number | null;
  /** Where the day splits: "HH:MM", "not-yet", "skipped", or null when blank. */
  lunch: DayPoint;
  eveningBreak: DayPoint;
  dinner: DayPoint;
  /** What they did in each stretch, in their words (DAY_STRETCHES keys). */
  dayNotes: Record<string, string>;
}

/** The stretches of the day the check-in asks about, split at lunch, the
 *  break and dinner. */
export const DAY_STRETCHES = [
  { key: "morning", from: "waking up", to: "lunch" },
  { key: "afternoon", from: "lunch", to: "the break" },
  { key: "evening", from: "the break", to: "dinner" },
  { key: "night", from: "dinner", to: "now" },
] as const;

/** Hours asleep from the sleep diary: in bed → up, less the time it took to
 *  fall asleep. Null unless both times are given. */
export function sleepHoursFrom(bedtime: string | null, wakeTime: string | null, latencyMin: number | null): number | null {
  const toMin = (t: string | null) => (t && /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
  const bed = toMin(bedtime);
  const up = toMin(wakeTime);
  if (bed === null || up === null) return null;
  let minutes = up - bed;
  if (minutes <= 0) minutes += 24 * 60;
  minutes -= latencyMin ?? 0;
  if (minutes <= 0 || minutes > 20 * 60) return null;
  return Math.round((minutes / 60) * 2) / 2;
}

function parseDayNotes(json: string | null | undefined): Record<string, string> {
  const notes: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const s of DAY_STRETCHES) {
        const v = (parsed as Record<string, unknown>)[s.key];
        if (typeof v === "string" && v.trim()) notes[s.key] = v.trim();
      }
    }
  } catch {
    // unreadable — the rest of the check-in still counts
  }
  return notes;
}

export type DayPoint = string | "not-yet" | "skipped" | null;

/** Anything else stored in a day-point column counts as blank. */
function toDayPoint(v: string | null | undefined): DayPoint {
  if (v === "not-yet" || v === "skipped") return v;
  return v && /^\d{2}:\d{2}$/.test(v) ? v : null;
}

export function isEmptyCheckIn(c: CheckInSummary): boolean {
  return (
    c.mood === null &&
    c.energy === null &&
    c.sleepHours === null &&
    !c.feeling &&
    !c.onMind &&
    Object.keys(c.habits).length === 0 &&
    !c.bedtime &&
    !c.wakeTime &&
    c.sleepLatencyMin === null &&
    c.sleepQuality === null &&
    c.lunch === null &&
    c.eveningBreak === null &&
    c.dinner === null &&
    Object.keys(c.dayNotes).length === 0
  );
}

/** Row → summary. A row with nothing filled in counts as no check-in. */
export function toCheckInSummary(row: CheckIn | null): CheckInSummary | null {
  if (!row) return null;
  const habits: Record<string, boolean> = {};
  try {
    const parsed: unknown = JSON.parse(row.habits || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean" && k.trim()) habits[k.trim()] = v;
      }
    }
  } catch {
    // unreadable habits JSON — keep the rest of the check-in
  }
  const summary: CheckInSummary = {
    mood: row.mood,
    energy: row.energy,
    sleepHours: row.sleep_hours,
    feeling: row.feeling?.trim() || null,
    onMind: row.on_mind?.trim() || null,
    habits,
    bedtime: row.bedtime || null,
    wakeTime: row.wake_time || null,
    sleepLatencyMin: row.sleep_latency_min ?? null,
    sleepQuality: row.sleep_quality ?? null,
    lunch: toDayPoint(row.lunch),
    eveningBreak: toDayPoint(row.evening_break),
    dinner: toDayPoint(row.dinner),
    dayNotes: parseDayNotes(row.day_notes),
  };
  return isEmptyCheckIn(summary) ? null : summary;
}

/** The check-in as prompt lines. Their own words are quoted so the model
 * can't mistake them for its own reading of the day. */
export function formatCheckInForPrompt(c: CheckInSummary | null): string {
  if (!c) return "(not filled in today)";
  const lines: string[] = [];
  if (c.mood !== null) lines.push(`- mood: ${c.mood}/10`);
  if (c.energy !== null) lines.push(`- energy: ${c.energy}/10`);
  if (c.sleepHours !== null) lines.push(`- slept last night: ${c.sleepHours}h`);
  if (c.bedtime || c.wakeTime) {
    lines.push(`- in bed ${c.bedtime ?? "?"}, up ${c.wakeTime ?? "?"}`);
  }
  if (c.sleepLatencyMin !== null) lines.push(`- took ${c.sleepLatencyMin} min to fall asleep`);
  if (c.sleepQuality !== null) lines.push(`- sleep quality: ${c.sleepQuality}/5`);
  if (c.feeling) lines.push(`- feeling, in their words: "${c.feeling}"`);
  if (c.onMind) lines.push(`- on their mind: "${c.onMind}"`);
  const habits = Object.entries(c.habits);
  if (habits.length > 0) {
    lines.push(`- habits today: ${habits.map(([k, done]) => `${k} ${done ? "done" : "not done"}`).join(", ")}`);
  }
  for (const [label, point] of dayPoints(c)) {
    if (point) lines.push(`- ${label}: ${point === "not-yet" ? "not yet" : point}`);
  }
  // Their own account of each stretch: the conversation builds on it rather
  // than asking again.
  for (const s of DAY_STRETCHES) {
    const text = c.dayNotes[s.key];
    if (text) lines.push(`- what they did, ${s.from} → ${s.to === "now" ? "later" : s.to}, in their words: "${text}"`);
  }
  return lines.join("\n");
}

function dayPoints(c: CheckInSummary | null): [string, DayPoint][] {
  return [
    ["lunch", c?.lunch ?? null],
    ["evening break", c?.eveningBreak ?? null],
    ["dinner", c?.dinner ?? null],
  ];
}

/**
 * The day in the parts the conversation walks through, split at waking up,
 * lunch, the evening break and dinner. A skipped point merges the parts on
 * either side; a point that hasn't happened yet ends the day at "now" (or, for
 * an earlier day, at the end of that day). Blank points still split the day,
 * without a time. One numbered line per part.
 */
export function formatDayParts(c: CheckInSummary | null, opts: { lookingBack?: boolean } = {}): string {
  const end = opts.lookingBack ? "the end of the day" : "now";
  const parts: string[] = [];
  let from = c?.wakeTime ? `waking up (${c.wakeTime})` : "waking up";
  let skipped: string[] = [];
  let notYet: string | null = null;
  for (const [label, point] of dayPoints(c)) {
    if (point === "skipped") {
      skipped.push(label);
      continue;
    }
    if (point === "not-yet") {
      notYet = label;
      break;
    }
    const to = point ? `${label} (${point})` : `${label} (time not given)`;
    parts.push(`${from} → ${to}${skipped.length ? ` — no ${skipped.join(" or ")} today` : ""}`);
    skipped = [];
    from = to;
  }
  const notes = [...(skipped.length ? [`no ${skipped.join(" or ")} today`] : []), ...(notYet ? [`${notYet} not yet`] : [])];
  parts.push(`${from} → ${end}${notes.length ? ` — ${notes.join(", ")}` : ""}`);
  return parts.map((p, i) => `${i + 1}. ${p}`).join("\n");
}

/** "tired, a bit anxious and hopeful" → ["tired", "a bit anxious", "hopeful"].
 * Pieces longer than three words are sentences, not feeling words — dropped. */
export function feelingWords(feeling: string | null): string[] {
  if (!feeling) return [];
  return feeling
    .toLowerCase()
    .split(/[,;/\n]|\band\b/)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter((s) => s.length > 0 && s.split(/\s+/).length <= 3);
}
