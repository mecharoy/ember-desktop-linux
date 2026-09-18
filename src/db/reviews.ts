import { getDb } from "./client";
import type { MonthlyReport, WeeklyReview } from "./types";

export interface ReviewClaim {
  claim: string;
  evidence: string;
  /** Days the evidence comes from — the card opens those entries. Absent on
   * reviews written before claims carried dates. */
  dates?: string[];
}

export interface SaveWeeklyReviewInput {
  weekStart: string; // Monday YYYY-MM-DD
  letter: string;
  strengths: ReviewClaim[];
  focusAreas: ReviewClaim[];
  createdAt: string;
  /** Comma-separated extracted dates the review was written from. */
  sourceDays: string;
}

/**
 * Drops reviews left with no days behind them, after an entry was deleted or
 * moved out of its week or month. The review jobs rewrite a period whose days
 * changed but skip one with no days, so without this a letter about a deleted
 * day would stay up. Weekly rows from before migration 0007 (no source_days)
 * are left alone, as the review jobs leave them.
 */
export async function deleteReviewsWithoutDays(): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM weekly_reviews
      WHERE source_days IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM day_metrics m
                         WHERE m.date >= weekly_reviews.week_start
                           AND m.date <= date(weekly_reviews.week_start, '+6 days'))`,
  );
  await db.execute(
    `DELETE FROM monthly_reports
      WHERE NOT EXISTS (SELECT 1 FROM day_metrics m WHERE substr(m.date, 1, 7) = monthly_reports.month)`,
  );
}

/** Upserts by week_start (UNIQUE) — a re-run replaces that week's review. */
export async function saveWeeklyReview(input: SaveWeeklyReviewInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO weekly_reviews (week_start, letter, strengths, focus_areas, created_at, source_days)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(week_start) DO UPDATE SET
       letter = excluded.letter,
       strengths = excluded.strengths,
       focus_areas = excluded.focus_areas,
       created_at = excluded.created_at,
       source_days = excluded.source_days`,
    [
      input.weekStart,
      input.letter,
      JSON.stringify(input.strengths),
      JSON.stringify(input.focusAreas),
      input.createdAt,
      input.sourceDays,
    ],
  );
}

export async function latestWeeklyReview(): Promise<WeeklyReview | null> {
  const db = await getDb();
  const rows = await db.select<WeeklyReview[]>(
    "SELECT * FROM weekly_reviews ORDER BY week_start DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

export async function listWeeklyReviews(): Promise<WeeklyReview[]> {
  const db = await getDb();
  return db.select<WeeklyReview[]>("SELECT * FROM weekly_reviews ORDER BY week_start DESC");
}

// ---------- monthly reports ----------

export interface SaveMonthlyReportInput {
  month: string; // YYYY-MM
  letter: string;
  changed: string;
  stats: string; // JSON
  sourceDays: string;
  createdAt: string;
  formulation?: string | null; // JSON Formulation
}

export async function saveMonthlyReport(input: SaveMonthlyReportInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO monthly_reports (month, letter, changed, stats, source_days, created_at, formulation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(month) DO UPDATE SET
       letter = excluded.letter,
       changed = excluded.changed,
       stats = excluded.stats,
       source_days = excluded.source_days,
       created_at = excluded.created_at,
       formulation = excluded.formulation`,
    [input.month, input.letter, input.changed, input.stats, input.sourceDays, input.createdAt, input.formulation ?? null],
  );
}

export async function listMonthlyReports(): Promise<MonthlyReport[]> {
  const db = await getDb();
  return db.select<MonthlyReport[]>("SELECT * FROM monthly_reports ORDER BY month DESC");
}
