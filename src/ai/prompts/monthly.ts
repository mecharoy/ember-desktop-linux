// Monthly report prompt. Written once a month is over,
// from numbers the app computes (the model quotes them, never recomputes)
// plus the month's extracted days.

import type { MonthStats } from "../../insights/stats";
import type { Assessment } from "../../db/types";
import { formatAssessmentsForPrompt } from "../../insights/assessments";

export interface MonthlyPromptInput {
  userName: string;
  stats: MonthStats;
  previous: MonthStats | null;
  days: { date: string; rawJson: string }[];
  /** Questionnaires taken this month — totals only reach the prompt. */
  assessments?: Pick<Assessment, "instrument" | "date" | "score">[];
}

export const MONTHLY_SYSTEM_PROMPT = `You are Ember's monthly reviewer.
Once a month is over you write a short month-in-review for the user.

Rules:
- The NUMBERS blocks were computed by the app. Quote from them; never
  recompute, re-round, or invent a number.
- The letter is warm and personal, 100-180 words, addressed to them by name
  in second person. It names the dominant theme, the best week and what made
  it good (from that week's days), and one thing worth carrying into next
  month. No headings, no bullet points.
- "changed" is ONE sentence: one concrete thing that changed since last
  month, grounded in the two NUMBERS blocks or the days. If there is no
  previous month to compare with, say so plainly instead of guessing.
- With fewer than 4 days recorded, keep the letter under 80 words and make
  no claims about patterns.
- Ground everything in the data. Never invent events.

THE FORMULATION — "the 5 Ps"
Clinicians sum up what is going on for someone under five headings. Write
the month's version from the extracted days only:
- presenting: the main difficulties this month, as they described them.
- predisposing: longer-standing background that makes those difficulties
  more likely — ONLY what they themselves said about their past or
  circumstances. Leave it empty rather than speculate.
- precipitating: what set off the hard stretches (events, pressures, days).
- perpetuating: what kept difficulties going (avoidance, poor sleep,
  rumination, thinking traps that recur, a situation that didn't change).
- protective: what helped or protected them (people, activities, strengths,
  habits that held).
Each point is one short plain sentence with no diagnosis, no labels and no
jargon, and "dates" lists the YYYY-MM-DD days from THIS MONTH'S EXTRACTED
DAYS that show it. A point you cannot tie to at least one day must be left
out. At most 4 points per heading; an empty heading is fine. With fewer than
4 days recorded, leave every heading empty.

Output ONLY a JSON object — no markdown code fences, no commentary — matching
exactly this shape:
{
  "letter": string,
  "changed": string,
  "formulation": {
    "presenting": [{"point": string, "dates": [string]}],
    "predisposing": [{"point": string, "dates": [string]}],
    "precipitating": [{"point": string, "dates": [string]}],
    "perpetuating": [{"point": string, "dates": [string]}],
    "protective": [{"point": string, "dates": [string]}]
  }
}`;

export function formatMonthStats(s: MonthStats): string {
  const f = (n: number | null) => (n === null ? "n/a" : n.toFixed(1));
  return [
    `month: ${s.month}`,
    `days journaled: ${s.daysJournaled}`,
    `average mood: ${f(s.avgMood)} / 10`,
    `average energy: ${f(s.avgEnergy)} / 10`,
    `top theme: ${s.topTheme ? `${s.topTheme.key} (${s.topTheme.count} days)` : "none"}`,
    `best week: ${
      s.bestWeek
        ? `week of ${s.bestWeek.weekStart}, average mood ${s.bestWeek.avgMood.toFixed(1)} over ${s.bestWeek.days} days`
        : "not enough days to say"
    }`,
  ].join("\n");
}

export function buildMonthlyUserPrompt(input: MonthlyPromptInput): string {
  const days =
    input.days.length === 0 ? "(none)" : input.days.map((d) => `${d.date}: ${d.rawJson}`).join("\n");
  return `USER: ${input.userName || "(name not set)"}

NUMBERS (this month):
${formatMonthStats(input.stats)}

NUMBERS (previous month):
${input.previous ? formatMonthStats(input.previous) : "(no previous month recorded)"}

WELLBEING QUESTIONNAIRES THIS MONTH (answered by them; quote, never reinterpret):
${formatAssessmentsForPrompt(input.assessments ?? [])}

THIS MONTH'S EXTRACTED DAYS (one JSON per day):
${days}

Return the JSON object now.`;
}
