// Standard questionnaires. Pure: definitions, scoring,
// bands and the "is one due" rule — unit-tested in assessments.test.ts.
//
// The wording below is each instrument's own and must stay verbatim: a
// questionnaire only means what its published score bands say if it is asked
// exactly as it was validated. Scores always come from the user answering the
// items, never from the AI reading their journal.
//
// Licences (not MIT — see README "Third-party content"):
// - WHO-5: © World Health Organization 2024, CC BY-NC-SA 3.0 IGO.
// - PHQ-9 and GAD-7: developed by Drs. Robert L. Spitzer, Janet B.W. Williams,
//   Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc.
//   No permission required to reproduce, translate, display or distribute.

import type { Assessment, Instrument } from "../db/types";
import { daysBetween } from "./stats";

export interface InstrumentDef {
  id: Instrument;
  name: string;
  /** Plain one-liner for Settings and the invitation card. */
  what: string;
  stem: string;
  items: string[];
  /** In display order. */
  options: { label: string; value: number }[];
  maxRaw: number;
  attribution: string;
}

/** Both kinds ask about the last two weeks, so none is offered again sooner —
 *  answering more often would re-count the same days. */
export const RECALL_DAYS = 14;

const FREQUENCY = [
  { label: "Not at all", value: 0 },
  { label: "Several days", value: 1 },
  { label: "More than half the days", value: 2 },
  { label: "Nearly every day", value: 3 },
];

const PHQ_ATTRIBUTION =
  "Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.";

export const INSTRUMENTS: Record<Instrument, InstrumentDef> = {
  who5: {
    id: "who5",
    name: "WHO-5 Well-Being Index",
    what: "Wellbeing. 5 questions.",
    stem:
      "Please indicate for each of the five statements which is closest to how you have been feeling over the last two weeks. Notice that higher numbers mean better well-being.",
    items: [
      "I have felt cheerful and in good spirits",
      "I have felt calm and relaxed",
      "I have felt active and vigorous",
      "I woke up feeling fresh and rested",
      "My daily life has been filled with things that interest me",
    ],
    options: [
      { label: "All of the time", value: 5 },
      { label: "Most of the time", value: 4 },
      { label: "More than half of the time", value: 3 },
      { label: "Less than half of the time", value: 2 },
      { label: "Some of the time", value: 1 },
      { label: "At no time", value: 0 },
    ],
    maxRaw: 25,
    attribution:
      "World Health Organization. The World Health Organization-Five Well-Being Index (WHO-5). Geneva: World Health Organization; 2024. License: CC BY-NC-SA 3.0 IGO.",
  },
  phq9: {
    id: "phq9",
    name: "PHQ-9",
    what: "Depression screening. 9 questions.",
    stem: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
    items: [
      "Little interest or pleasure in doing things",
      "Feeling down, depressed, or hopeless",
      "Trouble falling or staying asleep, or sleeping too much",
      "Feeling tired or having little energy",
      "Poor appetite or overeating",
      "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
      "Trouble concentrating on things, such as reading the newspaper or watching television",
      "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
      "Thoughts that you would be better off dead or of hurting yourself in some way",
    ],
    options: FREQUENCY,
    maxRaw: 27,
    attribution: PHQ_ATTRIBUTION,
  },
  gad7: {
    id: "gad7",
    name: "GAD-7",
    what: "Anxiety screening. 7 questions.",
    stem: "Over the last 2 weeks, how often have you been bothered by the following problems?",
    items: [
      "Feeling nervous, anxious or on edge",
      "Not being able to stop or control worrying",
      "Worrying too much about different things",
      "Trouble relaxing",
      "Being so restless that it is hard to sit still",
      "Becoming easily annoyed or irritable",
      "Feeling afraid as if something awful might happen",
    ],
    options: FREQUENCY,
    maxRaw: 21,
    attribution: PHQ_ATTRIBUTION,
  },
};

/** The PHQ-9's own follow-up question, asked when any item was above zero. */
export const PHQ9_DIFFICULTY = {
  question:
    "If you checked off any problems, how difficult have these problems made it for you to do your work, take care of things at home, or get along with other people?",
  options: [
    { label: "Not difficult at all", value: 0 },
    { label: "Somewhat difficult", value: 1 },
    { label: "Very difficult", value: 2 },
    { label: "Extremely difficult", value: 3 },
  ],
};

export const INSTRUMENT_ORDER: Instrument[] = ["who5", "phq9", "gad7"];

export function parseEnabledInstruments(csv: string): Instrument[] {
  const set = new Set(csv.split(",").map((s) => s.trim()));
  return INSTRUMENT_ORDER.filter((i) => set.has(i));
}

export function rawScore(answers: number[]): number {
  return answers.reduce((a, b) => a + b, 0);
}

/** What is shown: WHO-5 as its 0-100 percentage, the others as raw totals. */
export function displayScore(instrument: Instrument, raw: number): number {
  return instrument === "who5" ? raw * 4 : raw;
}

export function scaleLabel(instrument: Instrument): string {
  return instrument === "who5" ? "/100" : `/${INSTRUMENTS[instrument].maxRaw}`;
}

export interface Band {
  label: string;
  /** True where the instrument's own guidance says a closer look is worth it. */
  worthALook: boolean;
}

/**
 * The published bands. WHO-5: below 50 suggests poor well-being and further
 * assessment (WHO, 2024). PHQ-9: 0-4 / 5-9 / 10-14 / 15-19 / 20-27.
 * GAD-7: 0-4 / 5-9 / 10-14 / 15-21. For both, 10 is the usual point where
 * doctors look closer.
 */
export function bandFor(instrument: Instrument, raw: number): Band {
  if (instrument === "who5") {
    return raw * 4 < 50 ? { label: "low", worthALook: true } : { label: "fine", worthALook: false };
  }
  if (instrument === "phq9") {
    if (raw >= 20) return { label: "severe", worthALook: true };
    if (raw >= 15) return { label: "moderately severe", worthALook: true };
    if (raw >= 10) return { label: "moderate", worthALook: true };
    if (raw >= 5) return { label: "mild", worthALook: false };
    return { label: "minimal", worthALook: false };
  }
  if (raw >= 15) return { label: "severe", worthALook: true };
  if (raw >= 10) return { label: "moderate", worthALook: true };
  if (raw >= 5) return { label: "mild", worthALook: false };
  return { label: "minimal", worthALook: false };
}

/**
 * PHQ-9 item 9 above zero. The instrument's manual says any answer other than
 * "Not at all" calls for a closer look at risk, whatever the total — so the
 * app shows help first, before the score, rather than folding it in.
 */
export function needsCare(instrument: Instrument, answers: number[]): boolean {
  return instrument === "phq9" && (answers[8] ?? 0) > 0;
}

/** Complete, in range, one answer per item. */
export function isComplete(instrument: Instrument, answers: (number | null)[]): answers is number[] {
  const def = INSTRUMENTS[instrument];
  const allowed = new Set(def.options.map((o) => o.value));
  return answers.length === def.items.length && answers.every((a) => a !== null && allowed.has(a));
}

/**
 * Which opted-in questionnaires to offer today: never taken, or last taken at
 * least RECALL_DAYS ago — and nothing while the user has snoozed them.
 */
export function dueInstruments(
  enabled: Instrument[],
  taken: Pick<Assessment, "instrument" | "date">[],
  todayKey: string,
  snoozedUntil: string,
): Instrument[] {
  if (snoozedUntil && snoozedUntil > todayKey) return [];
  return enabled.filter((instrument) => {
    const last = taken
      .filter((a) => a.instrument === instrument)
      .map((a) => a.date)
      .sort()
      .pop();
    return !last || daysBetween(last, todayKey) >= RECALL_DAYS;
  });
}

/** One line per result for a review prompt: totals and bands only. Item
 *  answers — PHQ-9 item 9 above all — never go into a prompt. */
export function formatAssessmentsForPrompt(rows: Pick<Assessment, "instrument" | "date" | "score">[]): string {
  if (rows.length === 0) return "(none taken)";
  return rows
    .map((a) => {
      const def = INSTRUMENTS[a.instrument];
      return `- ${a.date}: ${def.name} ${displayScore(a.instrument, a.score)}${scaleLabel(a.instrument)} (${bandFor(a.instrument, a.score).label})`;
    })
    .join("\n");
}
