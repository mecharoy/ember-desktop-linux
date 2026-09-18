// What goes together in their days, counted here rather than by the model:
// for each habit, which themes, people, activities, struggles, low moods or
// short nights share its days (or come the day before) more often than
// chance would suggest. The Suggestions job (ai/patterns.ts) hands these
// counts to the model, which only has to choose and phrase the links; small
// models in particular can't be trusted to count. Pure — tested in links.test.ts.

import { addDays, type DayRow } from "./stats";

export interface LinkCandidate {
  habit: string;
  /** e.g. `theme "family conflict"`, `a low-mood day (4 or less)`. */
  with: string;
  /** "same day" or "the day before". */
  when: "same day" | "the day before";
  /** Habit days that had it. */
  together: number;
  habitDays: number;
  /** All days that had it. */
  withDays: number;
  totalDays: number;
  /** How many times more often than on an average day. */
  lift: number;
}

const canon = (k: string) => k.trim().toLowerCase();

function features(r: DayRow): string[] {
  const f: string[] = [];
  for (const t of r.x.themes) f.push(`theme "${canon(t.key)}"`);
  for (const p of r.x.people) f.push(`time with ${p.key.trim()}`);
  for (const a of r.x.activities) f.push(`activity "${canon(a.key)}"`);
  if (r.mood !== null && r.mood <= 4) f.push("a low-mood day (4 or less)");
  if (r.mood !== null && r.mood >= 7) f.push("a good-mood day (7 or more)");
  if (r.x.sleep_hours !== null && r.x.sleep_hours < 6) f.push("under 6 hours of sleep");
  return f;
}

/** Candidate links for the given habits, strongest first, at most `perHabit` each. */
export function linkCandidates(rows: DayRow[], habits: string[], perHabit = 5): LinkCandidate[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const featureDays = new Map<string, Set<string>>();
  for (const r of rows) for (const f of new Set(features(r))) featureDays.set(f, (featureDays.get(f) ?? new Set()).add(r.date));
  const total = rows.length;
  const out: LinkCandidate[] = [];

  for (const habit of habits) {
    const key = canon(habit);
    const done = rows.filter((r) => r.x.habits.some((h) => h.done && canon(h.key) === key)).map((r) => r.date);
    if (done.length < 3) continue;
    const found: LinkCandidate[] = [];
    for (const [f, days] of featureDays) {
      if (f.includes(`"${key}"`)) continue;
      for (const when of ["same day", "the day before"] as const) {
        const together = done.filter((d) => days.has(when === "same day" ? d : addDays(d, -1)) && (when === "same day" || byDate.has(addDays(d, -1)))).length;
        if (together < 3) continue;
        const lift = together / done.length / (days.size / total);
        if (lift < 1.3) continue;
        found.push({ habit, with: f, when, together, habitDays: done.length, withDays: days.size, totalDays: total, lift: Math.round(lift * 10) / 10 });
      }
    }
    found.sort((a, b) => b.together * b.lift - a.together * a.lift);
    out.push(...found.slice(0, perHabit));
  }
  return out;
}

export function formatCandidate(c: LinkCandidate): string {
  const when = c.when === "same day" ? "on the same day" : "on the day before";
  return `${c.habit} — ${c.with} ${when}: ${c.together} of ${c.habitDays} ${c.habit} days (all days: ${c.withDays} of ${c.totalDays}; ${c.lift}× usual)`;
}
