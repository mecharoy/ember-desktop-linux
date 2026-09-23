// Thinking patterns: the "thinking traps" of cognitive
// behavioural therapy — habits of thought, like catastrophising, that CBT
// teaches people to notice. Pure; unit-tested in thinking.test.ts.
//
// Two rules keep this honest. A trap is recorded only with a quote the user
// actually typed — checked here in code, because a model asked for quotes
// will sometimes invent a plausible one. And findings are "worth noticing",
// never a judgement of how someone thinks.

import type { DayRow } from "./stats";
import { addDays, canon } from "./stats";

export interface TrapDef {
  id: string;
  name: string;
  /** One plain sentence, shown next to the name. */
  plain: string;
}

export const TRAPS: TrapDef[] = [
  { id: "all_or_nothing", name: "All-or-nothing", plain: "Seeing it as total success or total failure, with nothing between." },
  { id: "overgeneralising", name: "Overgeneralising", plain: "One thing going wrong becomes “always” or “never”." },
  { id: "mental_filter", name: "Mental filter", plain: "Dwelling on one bad detail until it colours the whole picture." },
  { id: "discounting_positives", name: "Discounting the good", plain: "Waving away what went well as luck or not counting." },
  { id: "mind_reading", name: "Mind reading", plain: "Being sure what others think of you without them saying it." },
  { id: "fortune_telling", name: "Fortune telling", plain: "Predicting it will go badly, as if already decided." },
  { id: "catastrophising", name: "Catastrophising", plain: "Jumping to the worst possible outcome." },
  { id: "emotional_reasoning", name: "Emotional reasoning", plain: "“I feel it, so it must be true.”" },
  { id: "should_statements", name: "“Should” rules", plain: "Harsh rules about how you or others must be." },
  { id: "labelling", name: "Labelling", plain: "Calling yourself a name instead of describing what happened." },
  { id: "personalising", name: "Personalising", plain: "Taking the blame for things that weren't only up to you." },
];

const TRAP_IDS = new Set(TRAPS.map((t) => t.id));

const ALIASES: Record<string, string> = {
  "black and white": "all_or_nothing",
  "black-and-white": "all_or_nothing",
  "black_and_white": "all_or_nothing",
  "all or nothing": "all_or_nothing",
  "polarized thinking": "all_or_nothing",
  "overgeneralization": "overgeneralising",
  "overgeneralisation": "overgeneralising",
  "overgeneralizing": "overgeneralising",
  "filtering": "mental_filter",
  "disqualifying the positive": "discounting_positives",
  "discounting the positive": "discounting_positives",
  "mind-reading": "mind_reading",
  "fortune-telling": "fortune_telling",
  "catastrophizing": "catastrophising",
  "catastrophization": "catastrophising",
  "magnification": "catastrophising",
  "should statements": "should_statements",
  "shoulds": "should_statements",
  "labeling": "labelling",
  "mislabeling": "labelling",
  "personalization": "personalising",
  "personalizing": "personalising",
  "personalisation": "personalising",
  "blame": "personalising",
};

/** A model's label → one of TRAPS' ids, or null when it isn't one of them. */
export function normaliseTrapType(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (TRAP_IDS.has(t)) return t;
  const spaced = t.replace(/_/g, " ");
  if (ALIASES[t]) return ALIASES[t];
  if (ALIASES[spaced]) return ALIASES[spaced];
  const snake = t.replace(/[\s-]+/g, "_");
  return TRAP_IDS.has(snake) ? snake : null;
}

/** Lowercase, straight quotes, single spaces — so a quote still matches when
 *  the model tidied the whitespace or the apostrophes. */
function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛`]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export const MAX_TRAPS_PER_DAY = 5;

/**
 * Keeps only traps of a known type whose quote really is in what the user
 * typed (their messages and check-in text, not Elytra's or the entry's), one
 * per quote, at most MAX_TRAPS_PER_DAY.
 */
export function groundThinkingTraps(
  traps: { type: string; quote: string }[],
  userText: string,
): { type: string; quote: string }[] {
  const haystack = normaliseText(userText);
  const seen = new Set<string>();
  const kept: { type: string; quote: string }[] = [];
  for (const trap of traps) {
    const type = normaliseTrapType(trap.type);
    const quote = trap.quote.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
    const needle = normaliseText(quote);
    if (!type || needle.length < 4 || !haystack.includes(needle) || seen.has(needle)) continue;
    seen.add(needle);
    kept.push({ type, quote });
    if (kept.length >= MAX_TRAPS_PER_DAY) break;
  }
  return kept;
}

export interface TrapStat {
  trap: TrapDef;
  /** Journaled days it came up on, all time. */
  days: number;
  /** Days in the last 8 weeks. */
  recentDays: number;
  /** Newest first, at most 3. */
  examples: { date: string; quote: string }[];
  /** Themes present on the most of those days, at most 2. */
  themes: string[];
  dates: string[];
}

/** Shown only for a trap seen on at least this many days. */
export const TRAP_MIN_DAYS = 2;

export function thinkingTrapStats(rows: DayRow[], todayKey: string): TrapStat[] {
  const since = addDays(todayKey, -56);
  const byType = new Map<string, { dates: string[]; examples: { date: string; quote: string }[]; themes: Map<string, { key: string; n: number }> }>();

  for (const r of rows) {
    const typesToday = new Set<string>();
    for (const t of r.x.thinkingTraps) {
      let agg = byType.get(t.type);
      if (!agg) {
        agg = { dates: [], examples: [], themes: new Map() };
        byType.set(t.type, agg);
      }
      agg.examples.push({ date: r.date, quote: t.quote });
      if (typesToday.has(t.type)) continue;
      typesToday.add(t.type);
      agg.dates.push(r.date);
      for (const th of r.x.themes) {
        const c = canon(th.key);
        if (!c) continue;
        const e = agg.themes.get(c) ?? { key: th.key.trim(), n: 0 };
        e.n++;
        agg.themes.set(c, e);
      }
    }
  }

  const stats: TrapStat[] = [];
  for (const def of TRAPS) {
    const agg = byType.get(def.id);
    if (!agg || agg.dates.length < TRAP_MIN_DAYS) continue;
    stats.push({
      trap: def,
      days: agg.dates.length,
      recentDays: agg.dates.filter((d) => d >= since).length,
      examples: agg.examples.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3),
      themes: Array.from(agg.themes.values())
        .filter((t) => t.n >= 2)
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
        .slice(0, 2)
        .map((t) => t.key),
      dates: agg.dates,
    });
  }
  return stats.sort((a, b) => b.recentDays - a.recentDays || b.days - a.days);
}
