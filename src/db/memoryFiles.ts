// What Elytra knows about them, in a few short files they can read and edit
// (migration 0014). "About me" is the profile table; the rest live here.
// Written by ai/memoryFiles.ts after each weekly review; read by the
// conversation, whole for big models and a few relevant lines for small ones.

import { getDb } from "./client";
import { localStamp } from "../time";

export const MEMORY_FILE_NAMES = ["people", "behaviours", "patterns", "goals"] as const;
export type MemoryFileName = (typeof MEMORY_FILE_NAMES)[number];

export interface MemoryFile {
  name: MemoryFileName;
  content: string;
  user_edited: 0 | 1;
  updated_at: string;
}

/** Every file, in the fixed order; missing ones come back empty. */
export async function listMemoryFiles(): Promise<MemoryFile[]> {
  const db = await getDb();
  const rows = await db.select<MemoryFile[]>("SELECT * FROM memory_files");
  const byName = new Map(rows.map((r) => [r.name, r]));
  return MEMORY_FILE_NAMES.map((name) => byName.get(name) ?? { name, content: "", user_edited: 0, updated_at: "" });
}

/** byUser = they typed it; the next automatic update keeps their wording. */
export async function saveMemoryFile(name: MemoryFileName, content: string, byUser: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO memory_files (name, content, user_edited, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT(name) DO UPDATE SET
       content = excluded.content,
       user_edited = MAX(memory_files.user_edited, excluded.user_edited),
       updated_at = excluded.updated_at`,
    [name, content.trim(), byUser ? 1 : 0, localStamp()],
  );
}
