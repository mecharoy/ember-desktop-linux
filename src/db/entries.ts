import { getDb } from "./client";
import { localDateKey } from "../time";
import type { Entry } from "./types";
import { isoNowLocal } from "../time";

export interface SaveEntryInput {
  sessionId: number;
  date: string;
  title: string;
  narrative: string;
  highlights: string[];
  counselorNote: string;
  userEdited: boolean;
}

/** Upserts by date (entries.date is UNIQUE) — regenerating/resaving the same day replaces it. */
export async function saveEntry(input: SaveEntryInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, user_edited, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(date) DO UPDATE SET
       title = excluded.title,
       narrative = excluded.narrative,
       highlights = excluded.highlights,
       counselor_note = excluded.counselor_note,
       user_edited = excluded.user_edited`,
    [
      input.sessionId,
      input.date,
      input.title,
      input.narrative,
      JSON.stringify(input.highlights),
      input.counselorNote,
      input.userEdited ? 1 : 0,
      isoNowLocal(),
    ],
  );
}

/** Date of the most recent entry strictly before dateKey, or null if none —
 * feeds the counselor's "days since we last talked" context line. */
export async function latestEntryDateBefore(dateKey: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ date: string }[]>(
    "SELECT date FROM entries WHERE date < $1 ORDER BY date DESC LIMIT 1",
    [dateKey],
  );
  return rows[0]?.date ?? null;
}

export async function getEntryForDate(date: string): Promise<Entry | null> {
  const db = await getDb();
  const rows = await db.select<Entry[]>("SELECT * FROM entries WHERE date = $1", [date]);
  return rows[0] ?? null;
}

/**
 * Deletes a day's written entry and the numbers extracted from it. The
 * conversation, check-in and notes stay: with no entry on their session the
 * notes count as unjournaled again, and tonight's session takes them over.
 */
export async function deleteEntry(date: string): Promise<void> {
  const db = await getDb();
  // Numbers first: should the second statement fail, the entry is still there
  // and simply gets re-extracted, instead of Insights charting a deleted day.
  await db.execute("DELETE FROM day_metrics WHERE date = $1", [date]);
  await db.execute("DELETE FROM entries WHERE date = $1", [date]);
}

export type MoveEntryResult = { ok: true } | { ok: false; reason: string };

/**
 * Moves an entry to another day, together with its session (and so its
 * messages), extracted numbers and check-in. Notes keep the time they were
 * typed. Refused when the target day already holds anything of the user's.
 */
export async function moveEntry(fromDate: string, toDate: string): Promise<MoveEntryResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return { ok: false, reason: "Pick a date to move it to." };
  if (toDate === fromDate) return { ok: false, reason: "The entry is already on that date." };
  if (toDate > localDateKey()) return { ok: false, reason: "An entry can't be moved to a future date." };
  const entry = await getEntryForDate(fromDate);
  if (!entry) return { ok: false, reason: `There is no entry on ${fromDate}.` };

  const db = await getDb();
  // An entry saved after midnight can sit a day after its own conversation:
  // the session keeps the evening's date. That conversation and its check-in
  // are the entry's own, so moving back onto their day is allowed.
  const [own] = await db.select<{ date: string }[]>("SELECT date FROM sessions WHERE id = $1", [entry.session_id]);
  const ontoOwnDay = own?.date === toDate;
  const [taken] = await db.select<{ entry: number; checkin: number; talk: number }[]>(
    `SELECT EXISTS (SELECT 1 FROM entries WHERE date = $1) AS entry,
            EXISTS (SELECT 1 FROM checkins WHERE date = $1) AS checkin,
            EXISTS (SELECT 1 FROM sessions s WHERE s.date = $1 AND s.id <> $2
                      AND (EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id)
                           OR EXISTS (SELECT 1 FROM captures c WHERE c.session_id = s.id))) AS talk`,
    [toDate, entry.session_id],
  );
  if (taken.entry) return { ok: false, reason: `${toDate} already has an entry. Delete or move that one first.` };
  if (taken.talk) {
    return {
      ok: false,
      reason: `${toDate} has a conversation of its own that was never written up. Open that day in the calendar to write its entry instead.`,
    };
  }
  if (taken.checkin && !ontoOwnDay) {
    return {
      ok: false,
      reason: `${toDate} has a check-in of its own. Open that day in the calendar to write its entry instead.`,
    };
  }

  // All the target day can still hold is an empty session (a skipped-day
  // marker, or today's untouched one) and numbers with no entry behind them.
  // Both would collide with the day moving in.
  await db.execute("DELETE FROM sessions WHERE date = $1 AND id <> $2", [toDate, entry.session_id]);
  await db.execute("DELETE FROM day_metrics WHERE date = $1", [toDate]);
  await db.execute("UPDATE sessions SET date = $1 WHERE id = $2", [toDate, entry.session_id]);
  await db.execute("UPDATE entries SET date = $1 WHERE date = $2", [toDate, fromDate]);
  await db.execute("UPDATE day_metrics SET date = $1 WHERE date = $2", [toDate, fromDate]);
  // Skipped when the target keeps its own check-in (the after-midnight case):
  // the one on fromDate then belongs to that day's other session.
  await db.execute(
    "UPDATE checkins SET date = $1 WHERE date = $2 AND NOT EXISTS (SELECT 1 FROM checkins WHERE date = $1)",
    [toDate, fromDate],
  );
  return { ok: true };
}

/** The paper one entry is drawn on; null goes back to the default. */
export async function setEntryPaper(date: string, paper: string | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE entries SET paper = $1 WHERE date = $2", [paper, date]);
}

export async function listEntries(): Promise<Entry[]> {
  const db = await getDb();
  return db.select<Entry[]>("SELECT * FROM entries ORDER BY date DESC");
}

async function listEntryDates(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ date: string }[]>("SELECT date FROM entries ORDER BY date DESC");
  return rows.map((r) => r.date);
}

/** Consecutive days with saved entries, counted backward from today (or
 * from yesterday if today's entry isn't saved yet — an unfinished today
 * doesn't break the streak until the day actually ends). */
export async function computeStreak(): Promise<number> {
  const dates = new Set(await listEntryDates());
  if (dates.size === 0) return 0;

  const cursor = new Date();
  if (!dates.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (dates.has(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
