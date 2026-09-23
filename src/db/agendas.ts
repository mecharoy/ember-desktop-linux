// The checklist Elytra makes before a conversation (migration 0013): what to
// talk about from the past, today and the future. One per day.

import { getDb } from "./client";
import type { AgendaItem, SessionAgenda } from "./types";
import { localStamp } from "../time";

const SECTIONS = new Set(["past", "today", "future"]);
const STATES = new Set(["open", "done", "skip"]);

/** Stored JSON → items. Anything malformed is dropped, not thrown. */
export function parseAgendaItems(json: string | null | undefined): AgendaItem[] {
  try {
    const parsed: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): AgendaItem[] => {
      if (!x || typeof x !== "object") return [];
      const i = x as Record<string, unknown>;
      if (typeof i.id !== "string" || typeof i.text !== "string" || !i.text.trim()) return [];
      return [
        {
          id: i.id,
          section: SECTIONS.has(String(i.section)) ? (i.section as AgendaItem["section"]) : "today",
          text: i.text.trim(),
          state: STATES.has(String(i.state)) ? (i.state as AgendaItem["state"]) : "open",
          topic: typeof i.topic === "string" && i.topic ? i.topic : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** null when no checklist was made for that day. */
export async function getAgenda(date: string): Promise<AgendaItem[] | null> {
  const db = await getDb();
  const rows = await db.select<SessionAgenda[]>("SELECT * FROM session_agendas WHERE date = $1", [date]);
  return rows[0] ? parseAgendaItems(rows[0].items) : null;
}

export async function saveAgenda(date: string, items: AgendaItem[]): Promise<void> {
  const db = await getDb();
  const now = localStamp();
  await db.execute(
    `INSERT INTO session_agendas (date, items, created_at, updated_at) VALUES ($1, $2, $3, $3)
     ON CONFLICT(date) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
    [date, JSON.stringify(items), now],
  );
}

export interface ConversationPrep {
  items: AgendaItem[];
  briefing: string | null;
  chatSummary: string | null;
  /** How many of the session's messages the summary covers. */
  summaryUpto: number;
}

/** Everything the preparation step and the rolling chat window stored for a day. */
export async function getConversationPrep(date: string): Promise<ConversationPrep | null> {
  const db = await getDb();
  const rows = await db.select<SessionAgenda[]>("SELECT * FROM session_agendas WHERE date = $1", [date]);
  const r = rows[0];
  if (!r) return null;
  return {
    items: parseAgendaItems(r.items),
    briefing: r.briefing?.trim() || null,
    chatSummary: r.chat_summary?.trim() || null,
    summaryUpto: Number(r.summary_upto) || 0,
  };
}

export async function saveBriefing(date: string, briefing: string): Promise<void> {
  const db = await getDb();
  const now = localStamp();
  await db.execute(
    `INSERT INTO session_agendas (date, items, created_at, updated_at, briefing) VALUES ($1, '[]', $2, $2, $3)
     ON CONFLICT(date) DO UPDATE SET briefing = excluded.briefing, updated_at = excluded.updated_at`,
    [date, now, briefing],
  );
}

/** The summary of the chat's first `upto` messages; null clears it. */
export async function saveChatSummary(date: string, summary: string | null, upto: number): Promise<void> {
  const db = await getDb();
  const now = localStamp();
  await db.execute(
    `INSERT INTO session_agendas (date, items, created_at, updated_at, chat_summary, summary_upto) VALUES ($1, '[]', $2, $2, $3, $4)
     ON CONFLICT(date) DO UPDATE SET chat_summary = excluded.chat_summary, summary_upto = excluded.summary_upto,
       updated_at = excluded.updated_at`,
    [date, now, summary, upto],
  );
}

export async function deleteAgenda(date: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM session_agendas WHERE date = $1", [date]);
}
