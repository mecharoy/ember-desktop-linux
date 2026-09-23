// Pure statistics for the Insights dashboard. No db imports
// — every function takes rows and returns plain data, so all of it is
// unit-tested directly. Fetching lives in src/db/*; rendering in
// src/components/insights/*.

import type { DayMetrics } from "../db/types";

// ---------- parsed day rows ----------

export interface DayExtraction {
  themes: { key: string; sentiment: number }[];
  habits: { key: string; done: boolean }[];
  people: { key: string; sentiment: number }[];
  /** The extractor's labels for the day's feelings. */
  emotions: string[];
  /** Feeling words the user typed themselves; null on days extracted before
   * the extractor recorded them. */
  emotionsNamed: string[] | null;
  sleep_hours: number | null;
  /** "user" when the mood came from the check-in form. */
  moodSource: "user" | "ai" | null;
  /** What they did, with enjoyment and achievement 0-3 where their words said. */
  activities: { key: string; pleasure: number | null; mastery: number | null }[];
  /** Thinking traps, each with a quote checked against what they typed. */
  thinkingTraps: { type: string; quote: string }[];
  /** Routine anchors mentioned in the day, "HH:MM". */
  rhythm: { firstContact: string | null; workStart: string | null; dinner: string | null };
}

export interface DayRow {
  date: string; // YYYY-MM-DD
  mood: number | null;
  energy: number | null;
  summaryLine: string | null;
  x: DayExtraction;
}

const EMPTY_X: DayExtraction = {
  themes: [],
  habits: [],
  people: [],
  emotions: [],
  emotionsNamed: null,
  sleep_hours: null,
  moodSource: null,
  activities: [],
  thinkingTraps: [],
  rhythm: { firstContact: null, workStart: null, dinner: null },
};

const score03 = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;

const clock = (v: unknown): string | null => (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];

export function parseDayRows(metrics: Pick<DayMetrics, "date" | "mood" | "energy" | "summary_line" | "raw_json">[]): DayRow[] {
  return metrics
    .map((m) => {
      let x: DayExtraction = EMPTY_X;
      try {
        const raw = JSON.parse(m.raw_json) as Record<string, unknown>;
        if (typeof raw === "object" && raw !== null) {
          x = {
            themes: Array.isArray(raw.themes) ? (raw.themes as DayExtraction["themes"]).filter((t) => typeof t?.key === "string") : [],
            habits: Array.isArray(raw.habits) ? (raw.habits as DayExtraction["habits"]).filter((h) => typeof h?.key === "string") : [],
            people: Array.isArray(raw.people) ? (raw.people as DayExtraction["people"]).filter((p) => typeof p?.key === "string") : [],
            emotions: strings(raw.emotions),
            emotionsNamed: Array.isArray(raw.emotions_named) ? strings(raw.emotions_named) : null,
            sleep_hours: typeof raw.sleep_hours === "number" ? raw.sleep_hours : null,
            moodSource: raw.mood_source === "user" || raw.mood_source === "ai" ? raw.mood_source : null,
            activities: Array.isArray(raw.activities)
              ? (raw.activities as Record<string, unknown>[])
                  .filter((a) => typeof a?.key === "string")
                  .map((a) => ({ key: a.key as string, pleasure: score03(a.pleasure), mastery: score03(a.mastery) }))
              : [],
            thinkingTraps: Array.isArray(raw.thinking_traps)
              ? (raw.thinking_traps as Record<string, unknown>[])
                  .filter((t) => typeof t?.type === "string" && typeof t?.quote === "string")
                  .map((t) => ({ type: t.type as string, quote: t.quote as string }))
              : [],
            rhythm: (() => {
              const r = (raw.rhythm ?? {}) as Record<string, unknown>;
              return { firstContact: clock(r.first_contact), workStart: clock(r.work_start), dinner: clock(r.dinner) };
            })(),
          };
        }
      } catch {
        // unparseable raw_json (double-failed extraction) — keep the day, empty extraction
      }
      return { date: m.date, mood: m.mood, energy: m.energy, summaryLine: m.summary_line, x };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- date helpers ----------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long something can go unmentioned before Patterns stops listing it as
 * part of your life now. A person, a theme, a habit or an activity that has
 * not come up for a month has dropped out of the lists (a quiet line can still
 * show them); the journal itself keeps everything.
 */
export const STALE_AFTER_DAYS = 30;

/** Comparisons (what moves your mood, weekday rhythm, activities) count the
 *  last three months: long enough to have days on both sides, short enough
 *  that last winter doesn't decide what is true this autumn. */
export const ANALYSIS_DAYS = 90;

export function recentRows(rows: DayRow[], todayKey: string, days = ANALYSIS_DAYS): DayRow[] {
  const since = addDays(todayKey, -days);
  return rows.filter((r) => r.date >= since);
}

/** Still current: mentioned within STALE_AFTER_DAYS. */
export function isCurrent(lastSeen: string, todayKey: string): boolean {
  return lastSeen >= addDays(todayKey, -STALE_AFTER_DAYS);
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00`); // noon avoids DST edge day-shifts
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / MS_PER_DAY);
}

/** Monday of the week containing dateKey (weeks start on Monday). */
export function mondayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(dateKey, -shift);
}

export function distinctWeekCount(dates: string[]): number {
  return new Set(dates.map(mondayOf)).size;
}

export function avgOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export const canon = (key: string) => key.trim().toLowerCase();

// The bar every mood comparison must clear: at least this many days
// on each side, and a gap at least this big. Shared by Mood movers and the
// habit effect chip so the page never holds two standards at once.
export const MIN_SIDE = 10;
export const MIN_GAP = 0.8;

// ---------- A. vitals ----------

export interface Vitals {
  entriesThisMonth: number;
  avgMood7: number | null;
  moodDays7: number; // how many rated days avgMood7 rests on
  moodDelta: number | null; // vs previous 7 days; null unless both weeks have enough days
  avgEnergy7: number | null;
  energyDays7: number;
  energyDelta: number | null;
  capturesThisWeek: number;
}

/** A week-over-week arrow built from one or two days is noise, not a trend. */
export const MIN_DAYS_FOR_DELTA = 3;

function windowValues(rows: DayRow[], field: "mood" | "energy", fromKey: string, toKey: string): number[] {
  return rows
    .filter((r) => r.date >= fromKey && r.date <= toKey)
    .map((r) => r[field])
    .filter((v): v is number => v !== null);
}

export function computeVitals(
  rows: DayRow[],
  entryDates: string[],
  captureTimestamps: string[], // ISO local created_at strings
  todayKey: string,
): Vitals {
  const monthPrefix = todayKey.slice(0, 7);
  const weekStart = mondayOf(todayKey);
  const week = (field: "mood" | "energy") => {
    const current = windowValues(rows, field, addDays(todayKey, -6), todayKey);
    const previous = windowValues(rows, field, addDays(todayKey, -13), addDays(todayKey, -7));
    const avg = avgOf(current);
    const delta =
      current.length >= MIN_DAYS_FOR_DELTA && previous.length >= MIN_DAYS_FOR_DELTA
        ? avg! - avgOf(previous)!
        : null;
    return { avg, days: current.length, delta };
  };
  const mood = week("mood");
  const energy = week("energy");

  return {
    entriesThisMonth: entryDates.filter((d) => d.startsWith(monthPrefix)).length,
    avgMood7: mood.avg,
    moodDays7: mood.days,
    moodDelta: mood.delta,
    avgEnergy7: energy.avg,
    energyDays7: energy.days,
    energyDelta: energy.delta,
    capturesThisWeek: captureTimestamps.filter((t) => t.slice(0, 10) >= weekStart && t.slice(0, 10) <= todayKey).length,
  };
}

// ---------- B. mood & energy over time ----------

export interface MoodPoint {
  date: string;
  mood: number | null;
  energy: number | null;
  moodAvg: number | null; // 7-day rolling average (the bold signal line)
  energyAvg: number | null;
  summary: string | null;
}

/**
 * Continuous daily axis over the last `rangeDays`; missing days stay null so
 * the chart renders gaps, never zeros. The rolling average
 * at day D averages whatever values exist in [D-6, D], and is null when there
 * are none. The chart does not bridge nulls, so the line breaks after a full
 * week without entries instead of drawing a straight line across a holiday.
 */
export function buildMoodSeries(rows: DayRow[], rangeDays: number, todayKey: string): MoodPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const points: MoodPoint[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    const row = byDate.get(date) ?? null;
    const rollWindow = (field: "mood" | "energy"): number | null => {
      const values: number[] = [];
      for (let k = 0; k < 7; k++) {
        const v = byDate.get(addDays(date, -k))?.[field];
        if (v !== null && v !== undefined) values.push(v);
      }
      return avgOf(values);
    };
    points.push({
      date,
      mood: row?.mood ?? null,
      energy: row?.energy ?? null,
      moodAvg: rollWindow("mood"),
      energyAvg: rollWindow("energy"),
      summary: row?.summaryLine ?? null,
    });
  }
  return points;
}

/** Best and worst mood day of the visible range (subtle markers). */
export function bestAndWorstDay(points: MoodPoint[]): { best: MoodPoint | null; worst: MoodPoint | null } {
  const withMood = points.filter((p) => p.mood !== null);
  if (withMood.length < 2) return { best: null, worst: null };
  let best = withMood[0];
  let worst = withMood[0];
  for (const p of withMood) {
    if (p.mood! > best.mood!) best = p;
    if (p.mood! < worst.mood!) worst = p;
  }
  return best.mood === worst.mood ? { best: null, worst: null } : { best, worst };
}

// ---------- C. week rhythm ----------

export interface WeekdayMood {
  weekday: string; // "Mon" …
  avg: number | null;
  n: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Below this many days a weekday's average is shown as "too few days". */
export const WEEKDAY_MIN_DAYS = 3;

export function moodByWeekday(rows: DayRow[]): WeekdayMood[] {
  const buckets: number[][] = WEEKDAYS.map(() => []);
  for (const r of rows) {
    if (r.mood === null) continue;
    const idx = (new Date(`${r.date}T12:00:00`).getDay() + 6) % 7;
    buckets[idx].push(r.mood);
  }
  return WEEKDAYS.map((weekday, i) => ({ weekday, avg: avgOf(buckets[i]), n: buckets[i].length }));
}

/** Mean mood over every rated day — the "your usual" line on the weekday chart. */
export function overallMood(rows: DayRow[]): number | null {
  return avgOf(rows.map((r) => r.mood).filter((v): v is number => v !== null));
}

/** 24 hourly bins of when captures happen (created_at is local wall-clock). */
export function captureHourHistogram(captureTimestamps: string[]): { hour: number; count: number }[] {
  const bins = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const t of captureTimestamps) {
    const hour = Number(t.slice(11, 13));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) bins[hour].count++;
  }
  return bins;
}

// ---------- D/H. themes & people ----------

export interface KeyedSeries {
  key: string;
  count: number; // days it appeared
  sentiment: number | null; // mean
  spark: number[]; // appearances per week, oldest→newest (8 weeks)
  trend: "rising" | "fading" | null;
  dates: string[]; // for click-through to entries
  lastSeen: string;
}

/**
 * Rising/Fading: the share of journaled days a topic came up on in
 * the last 2 complete weeks vs the 5 weeks before. Shares, not raw counts —
 * otherwise journaling more often makes every topic look "rising". The
 * in-progress week (index 7) is left out, or everything would look "fading"
 * every Monday. Nothing is flagged until the history covers the whole prior
 * window: before that, the weeks before the first entry count as zeros and
 * every topic looks new.
 */
export function trendOf(
  spark: number[],
  entriesPerWeek: number[],
  historyCoversPrior: boolean,
): KeyedSeries["trend"] {
  if (!historyCoversPrior) return null;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const recentMentions = spark[5] + spark[6];
  const recentEntries = entriesPerWeek[5] + entriesPerWeek[6];
  const priorMentions = sum(spark.slice(0, 5));
  const priorEntries = sum(entriesPerWeek.slice(0, 5));
  if (recentEntries < 2 || priorEntries < 3) return null;
  const recentShare = recentMentions / recentEntries;
  const priorShare = priorMentions / priorEntries;
  if (recentMentions >= 2 && recentShare >= 0.25 && recentShare >= priorShare * 1.75) return "rising";
  if (priorMentions >= 2 && priorShare >= 0.2 && recentShare <= priorShare * 0.4) return "fading";
  return null;
}

function keyedStats(
  rows: DayRow[],
  todayKey: string,
  pick: (x: DayExtraction) => { key: string; sentiment?: number }[],
): KeyedSeries[] {
  const map = new Map<string, { key: string; sentiments: number[]; dates: string[] }>();
  for (const r of rows) {
    const seenToday = new Set<string>();
    for (const item of pick(r.x)) {
      const canonical = canon(item.key);
      if (canonical.length === 0) continue;
      let agg = map.get(canonical);
      if (!agg) {
        agg = { key: item.key.trim(), sentiments: [], dates: [] };
        map.set(canonical, agg);
      }
      if (!seenToday.has(canonical)) {
        seenToday.add(canonical);
        agg.dates.push(r.date);
      }
      if (typeof item.sentiment === "number") agg.sentiments.push(item.sentiment);
    }
  }

  // 8 weekly buckets ending this week
  const thisMonday = mondayOf(todayKey);
  const weekIndex = (d: string) => {
    const weeksAgo = Math.floor(daysBetween(mondayOf(d), thisMonday) / 7);
    return weeksAgo >= 0 && weeksAgo < 8 ? 7 - weeksAgo : -1;
  };
  const entriesPerWeek = Array.from({ length: 8 }, () => 0);
  for (const r of rows) {
    const i = weekIndex(r.date);
    if (i >= 0) entriesPerWeek[i]++;
  }
  const firstDay = rows[0]?.date ?? todayKey;
  const historyCoversPrior = firstDay < addDays(thisMonday, -42); // an entry in week 0 or earlier

  return Array.from(map.values()).map(({ key, sentiments, dates }) => {
    const spark = Array.from({ length: 8 }, () => 0);
    for (const d of dates) {
      const i = weekIndex(d);
      if (i >= 0) spark[i]++;
    }
    return {
      key,
      count: dates.length,
      sentiment: avgOf(sentiments),
      spark,
      trend: trendOf(spark, entriesPerWeek, historyCoversPrior),
      dates,
      lastSeen: dates[dates.length - 1],
    };
  });
}

/** Count damped by how long ago it last came up (two-week scale), so a topic
 * that filled January doesn't outrank this week's in September. */
function recencyScore(s: KeyedSeries, todayKey: string): number {
  return s.count / (1 + Math.max(0, daysBetween(s.lastSeen, todayKey)) / 14);
}

/** Themes, most alive first. */
export function themeStats(rows: DayRow[], todayKey: string): KeyedSeries[] {
  return keyedStats(rows, todayKey, (x) => x.themes).sort(
    (a, b) => recencyScore(b, todayKey) - recencyScore(a, todayKey) || b.count - a.count,
  );
}

/** People, whoever came up most recently first — not a ranking of who
 * matters most. */
export function peopleStats(rows: DayRow[], todayKey: string): KeyedSeries[] {
  return keyedStats(rows, todayKey, (x) => x.people).sort(
    (a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.count - a.count,
  );
}

// ---------- G. emotional vocabulary ----------

// The extractor asks for adjectives, but models drift into noun forms —
// without folding, "anxious" and "anxiety" would chart as two emotions.
const EMOTION_ALIASES: Record<string, string> = {
  anxiety: "anxious",
  frustration: "frustrated",
  anger: "angry",
  sadness: "sad",
  happiness: "happy",
  tiredness: "tired",
  exhaustion: "exhausted",
  stress: "stressed",
  pride: "proud",
  contentment: "content",
  gratitude: "grateful",
  overwhelm: "overwhelmed",
  loneliness: "lonely",
  excitement: "excited",
  calmness: "calm",
  worry: "worried",
  fear: "afraid",
  guilt: "guilty",
  irritation: "irritated",
  hopefulness: "hopeful",
};

export function canonicalEmotion(raw: string): string {
  const e = raw.trim().toLowerCase();
  return EMOTION_ALIASES[e] ?? e;
}

/** "named": words the user typed themselves. "inferred": the AI's labels. */
export type EmotionSource = "named" | "inferred";

export function emotionCounts(
  rows: DayRow[],
  sinceKey: string | null,
  source: EmotionSource = "inferred",
): { emotion: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (sinceKey && r.date < sinceKey) continue;
    const list = source === "named" ? (r.x.emotionsNamed ?? []) : r.x.emotions;
    for (const e of new Set(list.map(canonicalEmotion).filter(Boolean))) {
      map.set(e, (map.get(e) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([emotion, count]) => ({ emotion, count }))
    .sort((a, b) => b.count - a.count);
}

/** Days extracted since the user's own feeling words were recorded at all. */
export function countDaysWithNamedEmotions(rows: DayRow[]): number {
  return rows.filter((r) => r.x.emotionsNamed !== null).length;
}

// ---------- E. habits ----------

export interface HabitDetail {
  key: string;
  doneDates: Set<string>;
  skippedDates: Set<string>; // said they skipped it (done=false), from text or check-in
  lastDone: string | null;
  currentStreak: number; // consecutive done-days ending today or yesterday
  weeklyTotals: { weekStart: string; done: number }[]; // last 4 weeks, oldest→newest
  effect: { withAvg: number; withoutAvg: number; nWith: number; nWithout: number } | null;
}

export function habitDetail(rows: DayRow[], habitKey: string, todayKey: string): HabitDetail {
  const canonical = canon(habitKey);
  const doneDates = new Set<string>();
  const skippedDates = new Set<string>();
  for (const r of rows) {
    const mentions = r.x.habits.filter((h) => canon(h.key) === canonical);
    if (mentions.some((h) => h.done)) doneDates.add(r.date);
    else if (mentions.length > 0) skippedDates.add(r.date);
  }

  let cursor = doneDates.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let currentStreak = 0;
  while (doneDates.has(cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  const weeklyTotals: HabitDetail["weeklyTotals"] = [];
  for (let w = 3; w >= 0; w--) {
    const weekStart = addDays(mondayOf(todayKey), -7 * w);
    let done = 0;
    for (let d = 0; d < 7; d++) if (doneDates.has(addDays(weekStart, d))) done++;
    weeklyTotals.push({ weekStart, done });
  }

  // Effect chip: mood on done-days vs other journaled days, held to
  // the same bar as Mood movers. Only days since the habit first appeared
  // count — months from before the habit existed would pollute the "without"
  // side and inflate the effect.
  const sortedDone = Array.from(doneDates).sort();
  const firstSeen = sortedDone[0] ?? null;
  const tracked = rows.filter((r) => r.mood !== null && (firstSeen === null || r.date >= firstSeen));
  const withMood = tracked.filter((r) => doneDates.has(r.date)).map((r) => r.mood!);
  const withoutMood = tracked.filter((r) => !doneDates.has(r.date)).map((r) => r.mood!);
  let effect: HabitDetail["effect"] = null;
  if (withMood.length >= MIN_SIDE && withoutMood.length >= MIN_SIDE) {
    const withAvg = avgOf(withMood)!;
    const withoutAvg = avgOf(withoutMood)!;
    if (Math.abs(withAvg - withoutAvg) >= MIN_GAP) {
      effect = { withAvg, withoutAvg, nWith: withMood.length, nWithout: withoutMood.length };
    }
  }

  return {
    key: habitKey,
    doneDates,
    skippedDates,
    lastDone: sortedDone[sortedDone.length - 1] ?? null,
    currentStreak,
    weeklyTotals,
    effect,
  };
}

/**
 * What a day means for one habit. Four states the old grid drew identically:
 * - done / skipped: they said so (in the check-in or the conversation)
 * - unmentioned: they journaled that day but the habit never came up
 * - no-entry: no journal that day, so nothing is known
 */
export type HabitDayState = "done" | "skipped" | "unmentioned" | "no-entry" | "future";

export interface HabitMonthCell {
  date: string;
  day: number;
  state: HabitDayState;
}

/** One calendar month for a habit, Monday-first, with leading nulls so the
 * grid lines up under weekday labels. `month` is YYYY-MM. */
export function habitMonthCells(
  detail: Pick<HabitDetail, "doneDates" | "skippedDates">,
  journaledDates: Set<string>,
  month: string,
  todayKey: string,
): (HabitMonthCell | null)[] {
  const [y, m] = month.split("-").map(Number);
  const lead = (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (HabitMonthCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const state: HabitDayState =
      date > todayKey
        ? "future"
        : detail.doneDates.has(date)
          ? "done"
          : detail.skippedDates.has(date)
            ? "skipped"
            : journaledDates.has(date)
              ? "unmentioned"
              : "no-entry";
    cells.push({ date, day, state });
  }
  return cells;
}

/** Habit keys seen done in extractions, most frequent first (the
 * "discovered habits" list), minus the ones the user dismissed. */
export function discoveredHabits(
  rows: DayRow[],
  dismissed: Set<string> = new Set(),
  /** Only habits done on or after this day; the counts cover the same span. */
  sinceKey: string | null = null,
): { key: string; count: number }[] {
  const map = new Map<string, { key: string; count: number }>();
  for (const r of rows) {
    if (sinceKey && r.date < sinceKey) continue;
    const seen = new Set<string>();
    for (const h of r.x.habits) {
      if (!h.done) continue;
      const canonical = canon(h.key);
      if (!canonical || seen.has(canonical) || dismissed.has(canonical)) continue;
      seen.add(canonical);
      const agg = map.get(canonical) ?? { key: h.key.trim(), count: 0 };
      agg.count++;
      map.set(canonical, agg);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ---------- F. what moves your mood ----------

export interface MoodFinding {
  sentence: string;
  dates: string[]; // supporting days, for click-through
}

/** Short sleep, for the sleep finding. */
const SHORT_SLEEP_HOURS = 6;

export function moodMovers(rows: DayRow[], dismissedHabits: Set<string> = new Set()): MoodFinding[] {
  const findings: MoodFinding[] = [];
  const tracked = rows.filter((r) => r.mood !== null);
  const moodByDate = new Map(tracked.map((r) => [r.date, r.mood!]));
  const lastDate = rows[rows.length - 1]?.date ?? "2000-01-01";

  const compare = (
    pool: DayRow[],
    label: (withAvg: number, withoutAvg: number, nWith: number, nWithout: number) => string,
    has: (r: DayRow) => boolean,
  ): void => {
    const withDays = pool.filter(has);
    const withoutDays = pool.filter((r) => !has(r));
    if (withDays.length < MIN_SIDE || withoutDays.length < MIN_SIDE) return;
    const withAvg = avgOf(withDays.map((r) => r.mood!))!;
    const withoutAvg = avgOf(withoutDays.map((r) => r.mood!))!;
    if (Math.abs(withAvg - withoutAvg) < MIN_GAP) return;
    findings.push({
      sentence: label(withAvg, withoutAvg, withDays.length, withoutDays.length),
      dates: withDays.map((r) => r.date),
    });
  };

  const fmt = (n: number) => n.toFixed(1);
  const signed = (d: number) => `${d >= 0 ? "+" : ""}${fmt(d)}`;
  const habits = discoveredHabits(rows, dismissedHabits).slice(0, 8);
  const doneOn = (canonical: string) => (r: DayRow) =>
    r.x.habits.some((x) => canon(x.key) === canonical && x.done);

  for (const h of habits) {
    const hasHabit = doneOn(canon(h.key));
    // Same window rule as the habit effect chip: only days since the habit
    // first appeared — earlier history would pollute the "without" side.
    const firstSeen = rows.find(hasHabit)?.date;
    if (!firstSeen) continue;
    compare(
      tracked.filter((r) => r.date >= firstSeen),
      (w, wo, nW, nWo) => `Days with ${h.key} average mood ${fmt(w)} vs ${fmt(wo)} without (n=${nW}/${nWo}).`,
      hasHabit,
    );
  }

  const byCount = (a: KeyedSeries, b: KeyedSeries) => b.count - a.count;
  for (const p of peopleStats(rows, lastDate).sort(byCount).slice(0, 5)) {
    const canonical = canon(p.key);
    compare(
      tracked,
      (w, wo, nW) => `Days you mention ${p.key} average ${signed(w - wo)} mood (${nW} days).`,
      (r) => r.x.people.some((x) => canon(x.key) === canonical),
    );
  }

  for (const t of themeStats(rows, lastDate).sort(byCount).slice(0, 5)) {
    const canonical = canon(t.key);
    compare(
      tracked,
      (w, wo, nW) => `Days when "${t.key}" comes up average ${signed(w - wo)} mood (${nW} days).`,
      (r) => r.x.themes.some((x) => canon(x.key) === canonical),
    );
  }

  // Next-day relationships: does the day
  // AFTER a habit day feel different? Same thresholds as above.
  for (const h of habits) {
    const hasHabit = doneOn(canon(h.key));
    const firstSeen = rows.find(hasHabit)?.date;
    if (!firstSeen) continue;

    const morrowMoods = (pred: (r: DayRow) => boolean) =>
      rows
        .filter((r) => r.date >= firstSeen && pred(r))
        .map((r) => ({ date: addDays(r.date, 1), mood: moodByDate.get(addDays(r.date, 1)) }))
        .filter((m): m is { date: string; mood: number } => m.mood !== undefined);

    const after = morrowMoods(hasHabit);
    const afterWithout = morrowMoods((r) => !hasHabit(r));
    if (after.length < MIN_SIDE || afterWithout.length < MIN_SIDE) continue;
    const w = avgOf(after.map((m) => m.mood))!;
    const wo = avgOf(afterWithout.map((m) => m.mood))!;
    if (Math.abs(w - wo) < MIN_GAP) continue;
    findings.push({
      sentence: `The day after ${h.key}, mood averages ${fmt(w)} vs ${fmt(wo)} after days without (n=${after.length}/${afterWithout.length}).`,
      dates: after.map((m) => m.date),
    });
  }

  // Sleep, against their own usual: if short nights are simply
  // normal for them, "4 of your 5 worst days followed short sleep" means
  // nothing. Only days where sleep was mentioned count, and the worst days
  // must be clearly more short-slept than usual.
  const withSleep = tracked.filter((r) => r.x.sleep_hours !== null);
  if (withSleep.length >= MIN_SIDE) {
    const isShort = (r: DayRow) => r.x.sleep_hours! < SHORT_SLEEP_HOURS;
    const lowest = withSleep.slice().sort((a, b) => a.mood! - b.mood!).slice(0, 5);
    const short = lowest.filter(isShort);
    const usualShare = withSleep.filter(isShort).length / withSleep.length;
    if (short.length >= 3 && short.length / lowest.length >= usualShare + 0.3) {
      findings.push({
        sentence: `Your 5 lowest-mood days: ${short.length} followed short sleep (under ${SHORT_SLEEP_HOURS}h) — that happened on ${Math.round(usualShare * 100)}% of the ${withSleep.length} days you mentioned sleep.`,
        dates: short.map((r) => r.date),
      });
    }
  }

  return findings.slice(0, 8);
}

// ---------- J. monthly report numbers ----------

export interface MonthStats {
  month: string; // YYYY-MM
  daysJournaled: number;
  avgMood: number | null;
  avgEnergy: number | null;
  topTheme: { key: string; count: number } | null;
  bestWeek: { weekStart: string; avgMood: number; days: number } | null;
}

/**
 * The month's numbers, computed here so the monthly reviewer quotes them
 * instead of doing arithmetic. Best week = the highest average mood among
 * Monday-start weeks with at least 2 rated days inside the month.
 */
export function monthStats(rows: DayRow[], month: string): MonthStats {
  const inMonth = rows.filter((r) => r.date.startsWith(month));
  const nums = (field: "mood" | "energy") =>
    inMonth.map((r) => r[field]).filter((v): v is number => v !== null);

  const themeCounts = new Map<string, { key: string; count: number }>();
  for (const r of inMonth) {
    const seen = new Set<string>();
    for (const t of r.x.themes) {
      const canonical = canon(t.key);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      const agg = themeCounts.get(canonical) ?? { key: t.key.trim(), count: 0 };
      agg.count++;
      themeCounts.set(canonical, agg);
    }
  }
  const topTheme =
    Array.from(themeCounts.values()).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0] ?? null;

  const weeks = new Map<string, number[]>();
  for (const r of inMonth) {
    if (r.mood === null) continue;
    const w = mondayOf(r.date);
    weeks.set(w, [...(weeks.get(w) ?? []), r.mood]);
  }
  let bestWeek: MonthStats["bestWeek"] = null;
  for (const [weekStart, moods] of Array.from(weeks.entries()).sort()) {
    if (moods.length < 2) continue;
    const avg = avgOf(moods)!;
    if (!bestWeek || avg > bestWeek.avgMood) bestWeek = { weekStart, avgMood: avg, days: moods.length };
  }

  return {
    month,
    daysJournaled: inMonth.length,
    avgMood: avgOf(nums("mood")),
    avgEnergy: avgOf(nums("energy")),
    topTheme,
    bestWeek,
  };
}

// ---------- progressive disclosure gates ----------

export interface UnlockState {
  moodChart: boolean; // 5 entries
  weekRhythm: boolean; // 3 weeks and 14 entries
  themes: boolean; // 10 entries
  moodMovers: boolean; // 30 entries
  emotions: boolean; // 20 entries
  people: boolean; // 10 entries
}

export function computeUnlocks(entryDates: string[]): UnlockState {
  const n = entryDates.length;
  return {
    moodChart: n >= 5,
    // 3 entries, one per week, used to unlock this — seven weekday averages
    // from three days is noise dressed up as a pattern
    weekRhythm: distinctWeekCount(entryDates) >= 3 && n >= 14,
    themes: n >= 10,
    moodMovers: n >= 30,
    emotions: n >= 20,
    people: n >= 10,
  };
}
