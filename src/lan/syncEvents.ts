import { emit } from "@tauri-apps/api/event";
import { markJournalRestored, type ApplyResult } from "../db/sync";

const RESTORED = "ember-journal-restored";

/** Called just before a backup replaces the journal. The flag lives outside
 *  the database, which is about to be swapped. */
export function noteJournalRestore(): void {
  try {
    localStorage.setItem(RESTORED, "1");
  } catch {
    // Without storage the next sync just isn't a fresh start.
  }
}

/** Before the first sync after a restore: forget the backup's old sync
 *  records, so the paired device doesn't reset the restored journal again. */
export async function settleRestoredJournal(): Promise<void> {
  let restored = false;
  try {
    restored = localStorage.getItem(RESTORED) === "1";
  } catch {
    return;
  }
  if (!restored) return;
  await markJournalRestored();
  try {
    localStorage.removeItem(RESTORED);
  } catch {
    // Harmless: it would only make one more sync a fresh start.
  }
}

/** Tells the open pages what a sync changed, so they read it again. */
export async function announceSync(result: ApplyResult): Promise<void> {
  if (result.tables.length === 0) return;
  const t = new Set(result.tables);
  await emit("sync:applied", result);
  if (t.has("captures")) await emit("captures:updated");
  if (t.has("reminders")) await emit("reminders:changed");
  if (["weekly_reviews", "monthly_reports", "memory_summaries", "profile"].some((x) => t.has(x))) {
    await emit("reviews:updated");
  }
}

/** "just now", "5 min ago", "3 h ago", the date, or "never". */
export function sinceLabel(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
