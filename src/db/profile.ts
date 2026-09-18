import { getDb } from "./client";
import type { Profile } from "./types";

/** The rolling ≤400-word self-portrait, or null before the
 * first weekly review writes one. */
export async function getProfileSummary(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Profile[]>("SELECT * FROM profile WHERE id = 1");
  return rows[0]?.summary ?? null;
}

export async function setProfileSummary(summary: string, updatedAt: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO profile (id, summary, updated_at) VALUES (1, $1, $2)
     ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
    [summary, updatedAt],
  );
}
