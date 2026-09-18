import { getDb } from "./client";
import type { DayMetrics, Entry } from "./types";

export interface DayMetricsInput {
  date: string; // YYYY-MM-DD
  mood: number | null;
  energy: number | null;
  summaryLine: string | null;
  rawJson: string; // full extractor output, kept for reprocessing
}

/** Upserts by date (day_metrics.date is UNIQUE) — re-extracting a regenerated entry replaces the day. */
export async function upsertDayMetrics(input: DayMetricsInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO day_metrics (date, mood, energy, summary_line, raw_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(date) DO UPDATE SET
       mood = excluded.mood,
       energy = excluded.energy,
       summary_line = excluded.summary_line,
       raw_json = excluded.raw_json`,
    [input.date, input.mood, input.energy, input.summaryLine, input.rawJson],
  );
}

export async function getDayMetrics(date: string): Promise<DayMetrics | null> {
  const db = await getDb();
  const rows = await db.select<DayMetrics[]>("SELECT * FROM day_metrics WHERE date = $1", [date]);
  return rows[0] ?? null;
}

export async function listAllDayMetrics(): Promise<DayMetrics[]> {
  const db = await getDb();
  return db.select<DayMetrics[]>("SELECT * FROM day_metrics ORDER BY date ASC");
}

/** Saved entries with no usable extraction: the model failed twice (stored as
 * raw_json "{}") or it never ran because the app closed first. Oldest first. */
export async function listEntriesNeedingExtraction(): Promise<Entry[]> {
  const db = await getDb();
  return db.select<Entry[]>(
    `SELECT e.* FROM entries e
     LEFT JOIN day_metrics m ON m.date = e.date
     WHERE m.id IS NULL OR m.raw_json = '{}'
     ORDER BY e.date ASC`,
  );
}

/** The n most recent extracted days, newest first (context builder: neglected domains). */
export async function listRecentDayMetrics(n: number): Promise<DayMetrics[]> {
  const db = await getDb();
  return db.select<DayMetrics[]>("SELECT * FROM day_metrics ORDER BY date DESC LIMIT $1", [n]);
}
