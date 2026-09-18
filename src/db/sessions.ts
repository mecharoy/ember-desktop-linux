import { getDb } from "./client";
import type { Message, Session } from "./types";
import { isoNowLocal } from "../time";

export async function getSessionForDate(dateKey: string): Promise<Session | null> {
  const db = await getDb();
  const rows = await db.select<Session[]>("SELECT * FROM sessions WHERE date = $1", [dateKey]);
  return rows[0] ?? null;
}

/**
 * Missed days: on launch, any past session still 'open'
 * with no saved entry becomes 'skipped', and yesterday gets a skipped session
 * row if the day went completely untouched. Skips end streaks quietly —
 * insights never guilt-trip about them.
 */
export async function markMissedDaysSkipped(todayKey: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET status = 'skipped'
     WHERE date < $1 AND status = 'open'
       AND date NOT IN (SELECT date FROM entries)`,
    [todayKey],
  );
  const yesterday = new Date(`${todayKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const yKey = `${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}`;
  await db.execute(
    `INSERT INTO sessions (date, status)
     SELECT $1, 'skipped'
     WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE date = $1)
       AND NOT EXISTS (SELECT 1 FROM entries WHERE date = $1)`,
    [yKey],
  );
}

/** Idempotent: returns today's session row, creating it (status='open') if absent. */
export async function getOrCreateTodaySession(dateKey: string): Promise<Session> {
  const db = await getDb();
  const existing = await db.select<Session[]>("SELECT * FROM sessions WHERE date = $1", [dateKey]);
  if (existing[0]) return existing[0];

  await db.execute(
    "INSERT INTO sessions (date, started_at, status) VALUES ($1, $2, 'open')",
    [dateKey, isoNowLocal()],
  );
  const created = await db.select<Session[]>("SELECT * FROM sessions WHERE date = $1", [dateKey]);
  return created[0];
}

/**
 * Hands this session every note that no journal entry covers yet, up to the
 * end of dateKey.
 *
 * Deliberately not limited to today. A note from a day that was never written
 * up is still waiting to be journaled, and tonight's session is what will
 * finally do it — so the session takes those over too, and saving tonight's
 * entry clears the whole backlog at once. Without the takeover, an old note
 * would stay attached to its own entry-less session and carry forward for
 * ever, however many journals were written after it.
 */
export async function linkCapturesToSession(sessionId: number, dateKey: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE captures SET session_id = $1
      WHERE created_at < $2 || 'T~'
        AND (session_id IS NULL
             OR session_id NOT IN (SELECT session_id FROM entries))`,
    [sessionId, dateKey],
  );
}

export async function listMessages(sessionId: number): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>("SELECT * FROM messages WHERE session_id = $1 ORDER BY id ASC", [sessionId]);
}

export async function addMessage(
  sessionId: number,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO messages (session_id, role, content, created_at) VALUES ($1, $2, $3, $4)",
    [sessionId, role, content, isoNowLocal()],
  );
}

export async function wrapSession(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sessions SET status = 'wrapped', ended_at = $1 WHERE id = $2", [
    isoNowLocal(),
    sessionId,
  ]);
}

/**
 * Days with a conversation that no entry covers: talked about, never written
 * up. The Journal shows them so they aren't mistaken for empty days. More than
 * one message, because the hidden kickoff on its own isn't a conversation.
 */
export async function listUnwrittenConversationDays(): Promise<{ date: string; messages: number }[]> {
  const db = await getDb();
  return db.select<{ date: string; messages: number }[]>(
    `SELECT s.date AS date, COUNT(m.id) AS messages
       FROM sessions s
       JOIN messages m ON m.session_id = s.id
       LEFT JOIN entries e ON e.session_id = s.id
      WHERE e.id IS NULL
      GROUP BY s.id
     HAVING COUNT(m.id) > 1
      ORDER BY s.date`,
  );
}

/**
 * Where a day's conversation stands. "unfinished": it has messages, isn't
 * wrapped up and has no entry. Past midnight the Today tab keeps such a day
 * on screen instead of starting the new one mid-conversation.
 */
export async function conversationState(dateKey: string): Promise<"none" | "unfinished" | "done"> {
  const db = await getDb();
  const rows = await db.select<{ status: string; messages: number; written: number }[]>(
    `SELECT s.status AS status,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS messages,
            EXISTS (SELECT 1 FROM entries e WHERE e.session_id = s.id) AS written
       FROM sessions s WHERE s.date = $1`,
    [dateKey],
  );
  const s = rows[0];
  if (!s || s.messages === 0) return "none";
  return s.status === "wrapped" || s.written ? "done" : "unfinished";
}

/**
 * Clears a day's conversation so it can be had again from the opening line:
 * a bad first reply, a provider swapped mid-chat, a night that went sideways.
 * Only the messages go — the check-in, the captures and any saved entry stay,
 * and the session row keeps its id so nothing else has to be rewired. The
 * messages are gone for good, so the caller asks before calling this.
 */
export async function restartConversation(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages WHERE session_id = $1", [sessionId]);
  await db.execute(
    "UPDATE sessions SET status = 'open', ended_at = NULL, started_at = $1 WHERE id = $2",
    [isoNowLocal(), sessionId],
  );
}

/** Edge case: "two sessions same day — reopen the wrapped
 * session and append." Lets the user continue chatting the same calendar
 * day instead of being permanently locked into the entry-review screen. */
export async function reopenSession(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sessions SET status = 'open', ended_at = NULL WHERE id = $1", [sessionId]);
}
