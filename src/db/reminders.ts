// Task reminders (migration 0004). Created from counselor-chat markers
// (src/ai/reminders.ts), fired by the scheduler loop, listed/dismissed on the
// Today tab. Times are "YYYY-MM-DDTHH:MM" local — same-format strings compare
// lexicographically, so due checks are plain string comparisons.

import { getDb } from "./client";
import type { Reminder } from "./types";
import { localStamp } from "../time";

export async function createReminder(dueAt: string, text: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO reminders (due_at, text, status, created_at) VALUES ($1, $2, 'pending', $3)",
    [dueAt, text, localStamp()],
  );
}

/** All pending reminders, soonest first (includes overdue ones not yet fired). */
export async function listPendingReminders(): Promise<Reminder[]> {
  const db = await getDb();
  return db.select<Reminder[]>(
    "SELECT * FROM reminders WHERE status = 'pending' ORDER BY due_at ASC",
  );
}

/** Pending reminders whose time has arrived. `now` is "YYYY-MM-DDTHH:MM". */
export async function listDueReminders(now: string): Promise<Reminder[]> {
  const db = await getDb();
  return db.select<Reminder[]>(
    "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= $1 ORDER BY due_at ASC",
    [now],
  );
}

export async function markReminderFired(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE reminders SET status = 'fired' WHERE id = $1", [id]);
}

export async function dismissReminder(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE reminders SET status = 'dismissed' WHERE id = $1", [id]);
}
