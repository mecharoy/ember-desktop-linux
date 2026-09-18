// Every background review job in one call. Used by the scheduler's timer,
// by the hook after each saved entry is extracted, and by the Insights
// refresh button. Each job is a cheap no-op when nothing is due.

import { emit } from "@tauri-apps/api/event";
import { getSetting, setSetting } from "../db/settings";
import { runWeeklyReviewIfDue, type ReviewResult } from "./review";
import { runMonthlyReportIfDue, type MonthlyResult } from "./monthly";
import { runFortnightlySummaryIfDue, type FortnightResult } from "./fortnightly";
import { refreshMemoryFilesIfDue, type MemoryFilesResult } from "./memoryFiles";
import { backgroundBusy, conversationLikely, runInBackground } from "./modelActivity";

export interface ReviewJobsResult {
  weekly: ReviewResult | null;
  monthly: MonthlyResult | null;
  /** The fortnightly memory summary the evening chat reads. */
  fortnightly: FortnightResult | null;
  /** The memory files (people, behaviours, patterns, goals). */
  memory: MemoryFilesResult | null;
}

const NOTHING: ReviewJobsResult = { weekly: null, monthly: null, fortnightly: null, memory: null };

/**
 * `whenIdle`: with the local model, wait while a conversation is likely
 * (see modelActivity.ts); the scheduler tries again later. The Insights
 * refresh button runs now.
 */
export async function runReviewJobsAndNotify(opts: { whenIdle?: boolean } = {}): Promise<ReviewJobsResult> {
  const local = (await getSetting("provider")) === "local";
  if (backgroundBusy()) return NOTHING;
  if (local && opts.whenIdle && conversationLikely()) return NOTHING;

  return runInBackground(async (signal) => {
    const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
    const weekly = await runWeeklyReviewIfDue().catch(fail);
    const monthly = signal.aborted ? null : await runMonthlyReportIfDue().catch(fail);
    const fortnightly = signal.aborted ? null : await runFortnightlySummaryIfDue().catch(fail);
    const memory = signal.aborted ? null : await refreshMemoryFilesIfDue().catch(fail);

    // Remembered so Insights can say so; these run unseen and would otherwise
    // just never appear. Cleared by the next run with no failure. A job
    // stopped for a conversation isn't a failure.
    if (!signal.aborted) {
      const failed = (
        [
          ["weekly letter", weekly],
          ["monthly report", monthly],
          ["memory summary", fortnightly],
          ["memory files", memory],
        ] as const
      ).flatMap(([name, r]) => (r && !r.ok ? [`${name}: ${r.error}`] : []));
      await setSetting("jobs_last_error", failed.length > 0 ? failed.join(" · ") : "").catch(() => {});
    }

    if (weekly || monthly || fortnightly || memory) await emit("reviews:updated").catch(() => {});
    return { weekly, monthly, fortnightly, memory };
  });
}
