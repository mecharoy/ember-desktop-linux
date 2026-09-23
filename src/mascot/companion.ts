import { countCapturesForDate } from "../db/captures";
import { conversationState } from "../db/sessions";
import { computeStreak, getEntryForDate, latestEntryDateBefore } from "../db/entries";
import { loadPatterns, type Suggestion } from "../ai/patterns";
import { localDateKey } from "../time";
import { listAllDayMetrics } from "../db/metrics";
import { listEntries } from "../db/entries";
import { listCheckIns } from "../db/checkins";
import { parseDayRows } from "../insights/stats";
import { buildRecap, type RecapPeriod, type Slide } from "../insights/recap";

/**
 * What the beetle says when you tap it.
 *
 * Everything here is local and instant: a few counts out of the database, a
 * table of lines, and — once the day is dealt with — one of the suggestions
 * the model already wrote for Patterns, turned into a question. So the beetle
 * passes on the AI's reading of your weeks without calling a model itself: a
 * tap answers immediately, works with no network, and cannot invent anything
 * about you, because every word it says was either written here or written by
 * the model when it read sixty days of your journal.
 *
 * ONE line per situation. The line is WHERE YOU ARE in the day crossed with
 * WHAT TIME IT IS, and nothing else — no shuffling, no variants, no randomness
 * of any kind. Tap it twice and you get the same words; the words change only
 * when the day itself has changed. An earlier version kept two phrasings per
 * cell and picked between them, which read as a slot machine rather than as
 * something paying attention. If you add lines here, add situations, not
 * alternatives.
 *
 * Under that line sits one finding from Patterns (readInsight), so a tap also
 * tells you something the journal has shown — counted here, not written by a
 * model, and it too stays the same all day.
 *
 * This file is the same in elytra-desktop and elytra-mobile: change both.
 */

/** Where the day has got to. */
export type Stance = "away" | "empty" | "noted" | "talking" | "written" | "milestone";

export type Band = "early" | "midday" | "evening" | "late";

export interface DayStance {
  stance: Stance;
  /** Notes taken today. */
  notes: number;
  /** Days in a row with an entry. */
  streak: number;
  /** Days since the last entry, when there has been a gap. */
  gap: number;
  /** One of Patterns' own suggestions, to ask about. Null when none exist. */
  suggestion: Suggestion | null;
  /** One thing Patterns has found, in a sentence. Null until there is enough. */
  insight: string | null;
}

export function bandFor(d: Date = new Date()): Band {
  const h = d.getHours();
  if (h >= 22 || h < 5) return "late";
  if (h < 11) return "early";
  if (h < 17) return "midday";
  return "evening";
}

/** Reads the day. Any failure gives the neutral stance rather than throwing —
 *  a tap on the beetle must never be able to break the dock. */
export async function readDay(date = localDateKey()): Promise<DayStance> {
  try {
    const [notes, talk, entry, streak, patterns] = await Promise.all([
      countCapturesForDate(date),
      conversationState(date),
      getEntryForDate(date),
      computeStreak(),
      loadPatterns().catch(() => null),
    ]);
    let gap = 0;
    if (!entry) {
      const last = await latestEntryDateBefore(date);
      if (last) {
        const ms = new Date(`${date}T12:00:00`).getTime() - new Date(`${last}T12:00:00`).getTime();
        gap = Math.round(ms / 86_400_000);
      }
    }
    let stance: Stance = "empty";
    if (entry) stance = streak > 0 && streak % 7 === 0 ? "milestone" : "written";
    else if (talk === "unfinished") stance = "talking";
    else if (notes > 0) stance = "noted";
    else if (gap >= 3) stance = "away";
    return {
      stance,
      notes,
      streak,
      gap,
      suggestion: pickSuggestion(patterns?.suggestions ?? [], date),
      insight: await readInsight(date, streak).catch(() => null),
    };
  } catch {
    return { stance: "empty", notes: 0, streak: 0, gap: 0, suggestion: null, insight: null };
  }
}

/**
 * One finding from Patterns, for under the day's line. It is the same set of
 * facts the recap plays (insights/recap.ts), counted from the journal on this
 * device — no model call, nothing invented. The last week when that has
 * enough in it, otherwise the last month. Like the suggestion, it is the same
 * one all day and a different one tomorrow.
 */
async function readInsight(date: string, streak: number): Promise<string | null> {
  const [metrics, entries, checkins] = await Promise.all([listAllDayMetrics(), listEntries(), listCheckIns()]);
  const rows = parseDayRows(metrics);
  const base = { today: date, rows, entries, checkins, captureTimes: [], streak, suggestions: [] };
  let period: RecapPeriod = "week";
  let lines = insightLines(buildRecap({ ...base, period }), period);
  if (lines.length < 2) {
    period = "month";
    lines = insightLines(buildRecap({ ...base, period }), period);
  }
  if (lines.length === 0) return null;
  const day = Math.floor(new Date(`${date}T12:00:00`).getTime() / 86_400_000);
  return lines[day % lines.length];
}

/** The recap's slides as single sentences. Open, close and streak are left
 *  out: the first two are framing, and the streak already has its own line. */
export function insightLines(slides: Slide[], period: RecapPeriod): string[] {
  const span = period === "week" ? "this week" : "this month";
  const before = period === "week" ? "last week" : "the month before";
  const one = (n: number) => n.toFixed(1);
  const out: string[] = [];
  for (const s of slides) {
    switch (s.kind) {
      case "mood": {
        const diff = s.prevAvg === null ? null : s.avg - s.prevAvg;
        const trend =
          diff === null || Math.abs(diff) < 0.3 ? "" : `, ${diff > 0 ? "up" : "down"} ${one(Math.abs(diff))} on ${before}`;
        out.push(`Your mood ${span} averages ${one(s.avg)} out of 10${trend}.`);
        break;
      }
      case "bestDay": {
        const weekday = new Date(`${s.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
        out.push(`Your best day ${span} was ${weekday}${s.title ? `: “${s.title}”` : ""}.`);
        break;
      }
      case "theme":
        out.push(`“${s.key}” came up on ${s.count} days ${span}.`);
        break;
      case "people":
        out.push(`${s.key} was in your days ${s.count} times ${span}.`);
        break;
      case "feelings":
        out.push(`The feeling you ${s.own ? "named" : "described"} most ${span}: ${s.words[0].word}.`);
        break;
      case "lift":
        out.push(`Days with ${s.activity} ran higher ${span}: ${one(s.withAvg)} against ${one(s.withoutAvg)}.`);
        break;
      case "sleep":
        out.push(`You slept ${one(s.avgHours)} hours a night on average ${span}.`);
        break;
    }
  }
  return out;
}

/**
 * One of Patterns' suggestions to ask about — the same one all day, a
 * different one tomorrow, so you work through them rather than being shown a
 * new idea every time you tap.
 *
 * These were written by the model when it read the last sixty days for the
 * Patterns page, so the beetle is passing on the AI's own reading of your
 * days. It does NOT call a model itself: a tap has to answer instantly, work
 * with no network, and never invent anything about you. Reusing what has
 * already been written gives all three.
 */
function pickSuggestion(all: Suggestion[], date: string): Suggestion | null {
  if (all.length === 0) return null;
  const days = Math.floor(new Date(`${date}T12:00:00`).getTime() / 86_400_000);
  return all[days % all.length];
}

const NOTHING_YET: Record<Band, string> = {
  early: "Nothing down yet. The first note is the hard one; the rest follow.",
  midday: "Half a day and no notes. What happened this morning?",
  evening: "Nothing noted today. You can still talk it through from memory.",
  late: "Late, and the day is unwritten. A couple of lines is plenty.",
};

/** These follow the count, so they start mid-sentence: "3 notes so far." */
const NOTED: Record<Band, string> = {
  early: "so far, and it is still early.",
  midday: "so far, and the day is not done.",
  evening: "waiting to be talked through. This is the hour for it.",
  late: "still waiting. They will keep until tomorrow.",
};

const TALKING: Record<Band, string> = {
  early: "We started early today.",
  midday: "Still talking. No hurry.",
  evening: "Still going. Wrap up whenever it feels finished.",
  late: "Still open. Finish it or leave it — both are fine.",
};

const WRITTEN: Record<Band, string> = {
  early: "Today is already written. Early.",
  midday: "Today is written. Anything else goes in as notes.",
  evening: "Written and kept.",
  late: "Written. The day is closed.",
};

/** Day counts go in front of these; the hour matters less once something is
 *  being marked, so they do not vary by band either. */
const AWAY = "days since the last entry. Nothing to catch up on — today on its own is enough.";
const MILESTONE = "days in a row.";

/** Turns one of Patterns' suggestions into something the beetle can ask. The
 *  model wrote the habit name; the question around it is ours, so it reads as
 *  the beetle wondering rather than as a notification. */
function asQuestion(s: Suggestion): string {
  const habit = s.habit.trim();
  switch (s.kind) {
    case "cut back":
      return `Patterns thinks less “${habit}” would help. Do you think that is right?`;
    case "task":
      return `Patterns suggested one thing: ${s.title.replace(/\.$/, "")}. Worth doing today?`;
    case "change":
      return `Patterns suggested a change: ${s.title.replace(/\.$/, "")}. Would that work for you?`;
    default:
      return `Do you think “${habit}” would work? Patterns suggested it from your last few weeks.`;
  }
}

export function companionLine(day: DayStance, _date = localDateKey(), band = bandFor()): string {
  const n = day.notes;
  // Once the day is dealt with, there is nothing left to report — so that is
  // when the beetle has room to ask about what the model noticed instead.
  if (day.suggestion && (day.stance === "written" || day.stance === "milestone")) {
    return asQuestion(day.suggestion);
  }
  switch (day.stance) {
    case "milestone":
      return `${day.streak} ${MILESTONE}`;
    case "away":
      return `${day.gap} ${AWAY}`;
    case "written":
      return WRITTEN[band];
    case "talking":
      return TALKING[band];
    case "noted":
      return `${n} ${n === 1 ? "note" : "notes"} ${NOTED[band]}`;
    default:
      return NOTHING_YET[band];
  }
}
