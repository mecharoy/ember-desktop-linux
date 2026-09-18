// The evening check-in form (migration 0007): mood, energy, sleep, a feeling
// word, what's on their mind, pinned habits and (0010) lunch, evening break
// and dinner, (0013) what they did between those — filled in before the
// conversation starts. Their own ratings, so they beat anything inferred.

import { getDb } from "./client";
import type { CheckIn } from "./types";
import { localStamp } from "../time";

export interface CheckInInput {
  date: string;
  mood: number | null;
  energy: number | null;
  sleepHours: number | null;
  feeling: string | null;
  onMind: string | null;
  habits: Record<string, boolean>;
  /** Sleep diary (migration 0008): the night before `date`. */
  bedtime?: string | null;
  wakeTime?: string | null;
  sleepLatencyMin?: number | null;
  sleepQuality?: number | null;
  /** Where the day splits (migration 0010): "HH:MM", "not-yet" or "skipped". */
  lunch?: string | null;
  eveningBreak?: string | null;
  dinner?: string | null;
  /** What they did in each stretch of the day (migration 0013). */
  dayNotes?: Record<string, string> | null;
}

export async function getCheckIn(date: string): Promise<CheckIn | null> {
  const db = await getDb();
  const rows = await db.select<CheckIn[]>("SELECT * FROM checkins WHERE date = $1", [date]);
  return rows[0] ?? null;
}

export async function listCheckIns(): Promise<CheckIn[]> {
  const db = await getDb();
  return db.select<CheckIn[]>("SELECT * FROM checkins ORDER BY date ASC");
}

/** One per day; saving again replaces the day's answers. */
export async function saveCheckIn(input: CheckInInput): Promise<void> {
  const db = await getDb();
  const now = localStamp();
  await db.execute(
    `INSERT INTO checkins (date, mood, energy, sleep_hours, feeling, on_mind, habits, created_at, updated_at,
                           bedtime, wake_time, sleep_latency_min, sleep_quality, lunch, evening_break, dinner, day_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT(date) DO UPDATE SET
       mood = excluded.mood,
       energy = excluded.energy,
       sleep_hours = excluded.sleep_hours,
       feeling = excluded.feeling,
       on_mind = excluded.on_mind,
       habits = excluded.habits,
       updated_at = excluded.updated_at,
       bedtime = excluded.bedtime,
       wake_time = excluded.wake_time,
       sleep_latency_min = excluded.sleep_latency_min,
       sleep_quality = excluded.sleep_quality,
       lunch = excluded.lunch,
       evening_break = excluded.evening_break,
       dinner = excluded.dinner,
       day_notes = excluded.day_notes`,
    [
      input.date,
      input.mood,
      input.energy,
      input.sleepHours,
      input.feeling,
      input.onMind,
      JSON.stringify(input.habits),
      now,
      now,
      input.bedtime ?? null,
      input.wakeTime ?? null,
      input.sleepLatencyMin ?? null,
      input.sleepQuality ?? null,
      input.lunch ?? null,
      input.eveningBreak ?? null,
      input.dinner ?? null,
      input.dayNotes && Object.keys(input.dayNotes).length > 0 ? JSON.stringify(input.dayNotes) : null,
    ],
  );
}
