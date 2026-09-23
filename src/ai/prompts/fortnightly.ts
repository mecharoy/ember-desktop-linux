// Fortnightly memory summary prompt. Summary n is written
// from summary n-1 plus the journal entries no summary has covered yet, so
// what the evening chat carries stays bounded however long the journal gets.

import type { Assessment } from "../../db/types";
import { formatAssessmentsForPrompt } from "../../insights/assessments";

export interface FortnightPromptInput {
  userName: string;
  number: number;
  /** The previous summary, already formatted; null for the first one. */
  previous: string | null;
  numbers: FortnightNumbers;
  entries: { date: string; title: string; narrative: string; highlights: string[]; summaryLine: string | null }[];
  assessments: Pick<Assessment, "instrument" | "date" | "score">[];
}

export interface FortnightNumbers {
  from: string;
  to: string;
  entries: number;
  avgMood: number | null;
  avgEnergy: number | null;
  avgSleepHours: number | null;
}

export const FORTNIGHT_SYSTEM_PROMPT = `You are Elytra's memory keeper.
Every two weeks you fold the user's newest journal entries into a running
summary. The evening conversation will read ONLY your summary plus the
entries written after it — so anything you drop from the summary is gone
from Elytra's memory for good, and anything you keep costs space every night.

How to write it:
- Start from the PREVIOUS SUMMARY and update it with the NEW ENTRIES. Keep
  what still matters (ongoing situations, people, patterns, unresolved
  matters); update what changed; drop what is over and no longer relevant.
- Write like a careful clinician's case notes: factual, specific, plain
  words, no diagnosis, no labels, no jargon, no judgement. Use their own
  words for feelings where you can.
- Never invent. Every statement must come from the previous summary or the
  new entries. Where you are unsure, leave it out.
- Numbers come from the NUMBERS block — quote them, never recompute.
- Dates are YYYY-MM-DD from the entries.
- The whole summary stays under 700 words. Be brief where life was quiet.

Sections, each a short paragraph (or "" when there is nothing):
- overview: two or three sentences on these weeks as a whole.
- life_context: their situation — work or study, home, commitments, big
  circumstances — as it stands now.
- mood_and_energy: how mood and energy moved and what went with the ups and
  downs, citing NUMBERS.
- sleep_and_routine: sleep and daily rhythm, only as reported.
- relationships: the people who mattered in these weeks and how things are.
- strengths_and_coping: what helped, what they handled well, what protects them.
- patterns: things that keep recurring — triggers, reactions, thinking
  habits — worded as observations to check, not conclusions.
- wellbeing_checks: questionnaire results in this period from the block
  below, totals only, or "" if none.
- threads: ongoing matters, at most 8. Carry each from the previous summary
  with an updated status, add new ones, and mark finished ones "resolved"
  (a resolved thread is kept once, then dropped next time). status is one of
  "new", "ongoing", "improving", "worsening", "resolved".
- open_loops: plans, decisions pending, things they said they would do.
- follow_up: at most 5 things worth gently checking on in the coming
  conversations.

Output ONLY a JSON object — no markdown code fences, no commentary — matching
exactly this shape:
{
  "overview": string,
  "life_context": string,
  "mood_and_energy": string,
  "sleep_and_routine": string,
  "relationships": string,
  "strengths_and_coping": string,
  "patterns": string,
  "wellbeing_checks": string,
  "threads": [{"thread": string, "status": string, "note": string, "dates": [string]}],
  "open_loops": [string],
  "follow_up": [string]
}`;

function f1(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(1);
}

export function buildFortnightUserPrompt(input: FortnightPromptInput): string {
  const n = input.numbers;
  const entries = input.entries
    .map((e) =>
      [
        `### ${e.date} — ${e.title}`,
        e.summaryLine ? `(in one line: ${e.summaryLine})` : "",
        e.narrative,
        e.highlights.length > 0 ? `Highlights: ${e.highlights.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return `USER: ${input.userName || "(name not set)"}
THIS IS SUMMARY #${input.number}

PREVIOUS SUMMARY:
${input.previous ?? "(none — this is the first summary)"}

NUMBERS (computed by the app for the new entries):
- entries: ${n.entries}, from ${n.from} to ${n.to}
- average mood: ${f1(n.avgMood)} / 10
- average energy: ${f1(n.avgEnergy)} / 10
- average sleep: ${n.avgSleepHours === null ? "n/a" : `${n.avgSleepHours.toFixed(1)} h`}

WELLBEING QUESTIONNAIRES IN THIS PERIOD (answered by them):
${formatAssessmentsForPrompt(input.assessments)}

NEW ENTRIES (oldest first):
${entries || "(none)"}

Return the JSON object now.`;
}
