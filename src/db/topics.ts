// Topics Elytra keeps working through with them across conversations
// (migration 0013). Written after a conversation by ai/topics.ts; read when
// the next checklist is made and by the counselor prompt.

import { getDb } from "./client";
import type { Topic } from "./types";
import { localStamp } from "../time";

/** "Dispute with Dad!" → "dispute-with-dad". */
export function topicKey(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "topic"
  );
}

/** Open ones first, most recently discussed first. */
export async function listTopics(): Promise<Topic[]> {
  const db = await getDb();
  return db.select<Topic[]>(
    `SELECT * FROM topics
     ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'avoid' THEN 1 ELSE 2 END,
              COALESCE(last_discussed, first_seen) DESC`,
  );
}

export interface TopicUpsert {
  key: string;
  title: string;
  status: Topic["status"];
  notes: string;
  nextStep: string;
  /** The day it was talked about; null when only its status changed. */
  discussedOn: string | null;
}

export async function upsertTopic(t: TopicUpsert, today: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO topics (key, title, status, notes, next_step, first_seen, last_discussed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(key) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       notes = excluded.notes,
       next_step = excluded.next_step,
       last_discussed = COALESCE(excluded.last_discussed, topics.last_discussed),
       updated_at = excluded.updated_at`,
    [t.key, t.title, t.status, t.notes, t.nextStep, today, t.discussedOn, localStamp()],
  );
}

export async function setTopicStatus(key: string, status: Topic["status"]): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE topics SET status = $1, updated_at = $2 WHERE key = $3", [status, localStamp(), key]);
}

export async function deleteTopic(key: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM topics WHERE key = $1", [key]);
}
