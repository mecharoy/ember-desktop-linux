// Fortnightly memory summaries (migration 0008). The job
// that writes them is ai/fortnightly.ts; the chat reads the latest one.

import { getDb } from "./client";
import type { MemorySummary } from "./types";

/** Oldest first. */
export async function listMemorySummaries(): Promise<MemorySummary[]> {
  const db = await getDb();
  return db.select<MemorySummary[]>("SELECT * FROM memory_summaries ORDER BY number ASC");
}

export interface MemorySummaryInput {
  number: number;
  periodStart: string;
  periodEnd: string;
  summary: string;
  sourceDays: string;
  createdAt: string;
}

export async function saveMemorySummary(input: MemorySummaryInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO memory_summaries (number, period_start, period_end, summary, source_days, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.number, input.periodStart, input.periodEnd, input.summary, input.sourceDays, input.createdAt],
  );
}
