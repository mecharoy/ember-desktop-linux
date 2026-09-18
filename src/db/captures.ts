import { getDb } from "./client";
import type { Capture } from "./types";
import { isoNowLocal } from "../time";

export async function createCapture(
  text: string,
  moodEmoji: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO captures (created_at, text, mood_emoji) VALUES ($1, $2, $3)",
    [isoNowLocal(), text, moodEmoji],
  );
}

/** Captures whose created_at falls on the given local date, newest first.
 * Range predicate (not substr()) so idx_captures_created_at is usable:
 * ISO-local strings compare lexicographically, and 'T~' > any 'T23:59…'. */
export async function listCapturesForDate(dateKey: string): Promise<Capture[]> {
  const db = await getDb();
  return db.select<Capture[]>(
    "SELECT * FROM captures WHERE created_at >= $1 AND created_at < $1 || 'T~' ORDER BY created_at DESC",
    [dateKey],
  );
}

/**
 * Every note not yet covered by a written journal entry, up to the end of the
 * given local day, oldest first.
 *
 * "Covered" means: the note was consumed by a session (captures.session_id)
 * and that session has an entry. A note that was never picked up by a session,
 * or whose session was started but never written up, is still pending and
 * keeps carrying forward. This is what stops a day you didn't get round to
 * journaling from silently vanishing at midnight.
 */
export async function listUnjournaledCaptures(uptoDateKey: string): Promise<Capture[]> {
  const db = await getDb();
  return db.select<Capture[]>(
    `SELECT c.* FROM captures c
       LEFT JOIN entries e ON e.session_id = c.session_id
      WHERE c.created_at < $1 || 'T~'
        AND (c.session_id IS NULL OR e.id IS NULL)
      ORDER BY c.created_at ASC`,
    [uptoDateKey],
  );
}

/** How many notes are still waiting for a journal entry: the count behind
 *  the evening nudge, so a backlog from a skipped day is reflected in it. */
export async function countUnjournaledCaptures(uptoDateKey: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM captures c
       LEFT JOIN entries e ON e.session_id = c.session_id
      WHERE c.created_at < $1 || 'T~'
        AND (c.session_id IS NULL OR e.id IS NULL)`,
    [uptoDateKey],
  );
  return rows[0]?.count ?? 0;
}

/** Notes dropped on one specific day — the capture bar's "N today" badge. */
export async function countCapturesForDate(dateKey: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM captures WHERE created_at >= $1 AND created_at < $1 || 'T~'",
    [dateKey],
  );
  return rows[0]?.count ?? 0;
}

/** created_at timestamps of every capture on/after the given local date
 * (Insights: capture-time histogram + captures-this-week vital). */
export async function listCaptureTimesSince(dateKey: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ created_at: string }[]>(
    "SELECT created_at FROM captures WHERE substr(created_at, 1, 10) >= $1 ORDER BY created_at ASC",
    [dateKey],
  );
  return rows.map((r) => r.created_at);
}

export async function deleteCapture(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM captures WHERE id = $1", [id]);
}
