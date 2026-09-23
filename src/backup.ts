import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { closeDb } from "./db/client";
import { noteJournalRestore } from "./lan/syncEvents";
import { hasJournalData, readStagedBackup, snapshotDatabase, type BackupSummary } from "./db/backup";
import { getSetting, setSetting } from "./db/settings";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Documents/Elytra, where the daily copy goes. */
export function backupFolder(): Promise<string> {
  return invoke<string>("backup_folder");
}

/** Writes Documents/Elytra/Elytra backup.db now. Throws with a readable message. */
export async function backupNow(): Promise<void> {
  try {
    await snapshotDatabase(await invoke<string>("backup_snapshot_path"));
    await invoke<string>("backup_save_copy");
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
  await setSetting("backup_last_at", new Date().toISOString());
}

/** Once a day: refresh the copy if it's switched on and there is something
 *  to keep. Failures wait for the next day. */
export async function backupIfDue(): Promise<void> {
  try {
    if ((await getSetting("backup_copy")) !== "1") return;
    const last = Date.parse(await getSetting("backup_last_at"));
    if (!Number.isNaN(last) && Date.now() - last < DAY_MS) return;
    if (!(await hasJournalData())) return;
    await backupNow();
  } catch {
    // A missed backup shouldn't interrupt anything.
  }
}

/** Asks for a backup file, copies it aside and says what's in it. Nothing is
 *  replaced yet. Returns null if nothing was picked; throws on a bad file. */
export async function pickBackup(): Promise<BackupSummary | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Pick your Elytra backup",
    defaultPath: await backupFolder().catch(() => undefined),
    filters: [{ name: "Elytra backup", extensions: ["db"] }],
  });
  if (!picked) return null;
  const bytes = await readFile(picked);
  try {
    await invoke("backup_stage", bytes);
  } catch (e) {
    throw new Error(String(e));
  }
  return readStagedBackup();
}

/** Puts the picked backup in place of the current journal and reloads Elytra. */
export async function restorePickedBackup(): Promise<void> {
  noteJournalRestore();
  await closeDb();
  try {
    await invoke("backup_restore");
  } catch (e) {
    // The old journal is still in place; reopen it.
    window.location.reload();
    throw new Error(String(e));
  }
  window.location.reload();
}
