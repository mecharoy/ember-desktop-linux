// User reference documents (migration 0006): .md/.txt files added in
// Settings. Enabled ones are loaded into every counselor session by
// src/ai/context.ts; the prompt formatting lives in src/ai/documents.ts.

import { getDb } from "./client";
import type { UserDocument } from "./types";
import { localStamp } from "../time";

/** All documents, in the order they were first added. */
export async function listDocuments(): Promise<UserDocument[]> {
  const db = await getDb();
  return db.select<UserDocument[]>("SELECT * FROM documents ORDER BY id ASC");
}

/** The ones loaded into a session. Stable order keeps the cached prompt stable. */
export async function listEnabledDocuments(): Promise<UserDocument[]> {
  const db = await getDb();
  return db.select<UserDocument[]>("SELECT * FROM documents WHERE enabled = 1 ORDER BY id ASC");
}

/** Adds a document, or replaces the text of the one with the same file name —
 *  re-adding an edited file updates it in place and keeps its on/off state. */
export async function saveDocument(name: string, content: string): Promise<void> {
  const db = await getDb();
  const now = localStamp();
  await db.execute(
    `INSERT INTO documents (name, content, enabled, created_at, updated_at) VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    [name, content, now, now],
  );
}

export async function setDocumentEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE documents SET enabled = $1 WHERE id = $2", [enabled ? 1 : 0, id]);
}

export async function removeDocument(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM documents WHERE id = $1", [id]);
}
