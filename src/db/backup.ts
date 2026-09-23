import { getDb, withStagedBackup } from "./client";

/** What a picked backup holds, shown before it replaces anything. */
export interface BackupSummary {
  name: string;
  entries: number;
  notes: number;
  /** YYYY-MM-DD of the latest entry or note, null when there are none. */
  lastDay: string | null;
}

type Reader = { select<T>(sql: string, params?: unknown[]): Promise<T> };

export async function summarizeBackup(db: Reader): Promise<BackupSummary> {
  let rows: { name: string | null; entries: number; notes: number; lastDay: string | null }[];
  try {
    rows = await db.select(
      `SELECT
         (SELECT value FROM settings WHERE key = 'user_name') AS name,
         (SELECT COUNT(*) FROM entries) AS entries,
         (SELECT COUNT(*) FROM captures) AS notes,
         (SELECT MAX(d) FROM (SELECT MAX(date) AS d FROM entries
                              UNION ALL SELECT MAX(substr(created_at, 1, 10)) FROM captures)) AS lastDay`,
    );
  } catch {
    throw new Error('That file has no journal in it. Look for "Elytra backup.db" in Documents/Elytra — or "Ember backup.db", if it was saved before the rename.');
  }
  const row = rows[0];
  return {
    name: row?.name ?? "",
    entries: Number(row?.entries ?? 0),
    notes: Number(row?.notes ?? 0),
    lastDay: row?.lastDay ?? null,
  };
}

/** Summary of the backup waiting to be restored. */
export function readStagedBackup(): Promise<BackupSummary> {
  return withStagedBackup(summarizeBackup);
}

/** Writes a consistent copy of the whole database to `path` (which must not
 *  exist yet), even while other writes are going on. */
export async function snapshotDatabase(path: string): Promise<void> {
  const db = await getDb();
  await db.execute("VACUUM INTO $1", [path]);
}

/** Whether there is anything worth backing up yet. */
export async function hasJournalData(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT (SELECT COUNT(*) FROM entries) + (SELECT COUNT(*) FROM captures) AS n",
  );
  return (rows[0]?.n ?? 0) > 0;
}
