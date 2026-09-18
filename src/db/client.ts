import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

/**
 * Singleton connection to ember.db (sqlite, via tauri-plugin-sql).
 * Migrations run automatically on load — see src-tauri/migrations/.
 * This is the ONLY module that should import "@tauri-apps/plugin-sql".
 * Everything else goes through the typed functions in src/db/*.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:ember.db");
  }
  return dbPromise;
}

/** A picked backup waits next to ember.db under this name (lib.rs, Backup.kt). */
const STAGED_BACKUP = "sqlite:ember-restore-candidate.db";

/** Opens the picked backup on its own connection, without migrations, and
 *  closes it again so the file can be moved into place. */
export async function withStagedBackup<T>(read: (db: Database) => Promise<T>): Promise<T> {
  const db = await Database.load(STAGED_BACKUP);
  try {
    return await read(db);
  } finally {
    // Named: close() on its own shuts every connection, ember.db's too.
    await db.close(STAGED_BACKUP);
  }
}

/** Closes the connection so the file can be swapped for a restored backup.
 *  Nothing may touch the database afterwards; the app restarts. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.close();
}
