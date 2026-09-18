// Questionnaires the user answered themselves (migration 0008).
// Scoring lives in insights/assessments.ts; this file only stores.

import { getDb } from "./client";
import type { Assessment, Instrument } from "./types";
import { localStamp } from "../time";

export interface AssessmentInput {
  instrument: Instrument;
  date: string;
  answers: number[];
  score: number;
  difficulty: number | null;
}

/** One per instrument per day; taking it again the same day replaces it. */
export async function saveAssessment(input: AssessmentInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO assessments (instrument, date, answers, score, difficulty, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(instrument, date) DO UPDATE SET
       answers = excluded.answers,
       score = excluded.score,
       difficulty = excluded.difficulty,
       created_at = excluded.created_at`,
    [input.instrument, input.date, JSON.stringify(input.answers), input.score, input.difficulty, localStamp()],
  );
}

/** Oldest first. */
export async function listAssessments(): Promise<Assessment[]> {
  const db = await getDb();
  return db.select<Assessment[]>("SELECT * FROM assessments ORDER BY date ASC, instrument ASC");
}
