import { describe, expect, it } from "vitest";
import {
  addDays,
  bestAndWorstDay,
  buildMoodSeries,
  captureHourHistogram,
  computeUnlocks,
  computeVitals,
  countDaysWithNamedEmotions,
  discoveredHabits,
  distinctWeekCount,
  emotionCounts,
  habitDetail,
  habitMonthCells,
  mondayOf,
  monthStats,
  moodByWeekday,
  moodMovers,
  overallMood,
  parseDayRows,
  peopleStats,
  themeStats,
  trendOf,
} from "./stats";

const TODAY = "2026-07-09"; // a Thursday

function metric(date: string, mood: number | null, x: object = {}, energy: number | null = null, summary = "s") {
  return { date, mood, energy, summary_line: summary, raw_json: JSON.stringify(x) };
}

describe("date helpers", () => {
  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-06-30", 2)).toBe("2026-07-02");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });
  it("mondayOf is Monday-start", () => {
    expect(mondayOf("2026-07-09")).toBe("2026-07-06"); // Thu → that week's Mon
    expect(mondayOf("2026-07-06")).toBe("2026-07-06"); // Mon → itself
    expect(mondayOf("2026-07-12")).toBe("2026-07-06"); // Sun → previous Mon
  });
  it("distinctWeekCount", () => {
    expect(distinctWeekCount(["2026-07-06", "2026-07-08", "2026-07-13", "2026-06-29"])).toBe(3);
  });
});

describe("parseDayRows", () => {
  it("keeps days with unparseable raw_json (empty extraction)", () => {
    const rows = parseDayRows([{ date: "2026-07-01", mood: 5, energy: 4, summary_line: "s", raw_json: "garbage" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].x.themes).toEqual([]);
    expect(rows[0].x.emotionsNamed).toBeNull();
  });

  it("reads the user's own feeling words and where the mood came from", () => {
    const [r] = parseDayRows([metric(TODAY, 4, { emotions_named: ["drained"], mood_source: "user" })]);
    expect(r.x.emotionsNamed).toEqual(["drained"]);
    expect(r.x.moodSource).toBe("user");
    const [old] = parseDayRows([metric(TODAY, 4, { emotions: ["tired"] })]);
    expect(old.x.emotionsNamed).toBeNull(); // extracted before the field existed
  });
});

describe("computeVitals", () => {
  it("computes 7-day averages and the delta when both weeks have 3+ days", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -9), 4),
      metric(addDays(TODAY, -8), 4),
      metric(addDays(TODAY, -7), 4),
      metric(addDays(TODAY, -2), 6),
      metric(addDays(TODAY, -1), 6),
      metric(TODAY, 6),
    ]);
    const v = computeVitals(rows, [TODAY], [], TODAY);
    expect(v.avgMood7).toBe(6);
    expect(v.moodDays7).toBe(3);
    expect(v.moodDelta).toBe(2);
  });

  it("shows no week-over-week arrow built from one or two days", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -8), 4),
      metric(addDays(TODAY, -7), 4),
      metric(addDays(TODAY, -1), 6),
      metric(TODAY, 6),
    ]);
    const v = computeVitals(rows, [TODAY], [], TODAY);
    expect(v.avgMood7).toBe(6);
    expect(v.moodDays7).toBe(2);
    expect(v.moodDelta).toBeNull();
  });

  it("counts entries this month and captures this week", () => {
    const v = computeVitals(
      [],
      ["2026-07-01", "2026-07-05", "2026-06-30"],
      ["2026-07-06T09:00:00.000+05:30", "2026-07-08T22:15:00.000+05:30", "2026-07-04T10:00:00.000+05:30"],
      TODAY,
    );
    expect(v.entriesThisMonth).toBe(2);
    expect(v.capturesThisWeek).toBe(2); // week starts Mon 2026-07-06
  });
});

describe("buildMoodSeries", () => {
  it("leaves gaps for missing days (null, never zero)", () => {
    const rows = parseDayRows([metric(addDays(TODAY, -2), 7), metric(TODAY, 5)]);
    const pts = buildMoodSeries(rows, 4, TODAY);
    expect(pts).toHaveLength(4);
    expect(pts[0].mood).toBeNull();
    expect(pts[1].mood).toBe(7);
    expect(pts[2].mood).toBeNull();
    expect(pts[3].mood).toBe(5);
  });

  it("rolls a 7-day average over the values present", () => {
    const rows = parseDayRows([metric(addDays(TODAY, -1), 4), metric(TODAY, 8)]);
    const pts = buildMoodSeries(rows, 2, TODAY);
    expect(pts[0].moodAvg).toBe(4);
    expect(pts[1].moodAvg).toBe(6);
  });

  it("breaks the average after a full week with no entries, instead of bridging it", () => {
    const rows = parseDayRows([metric(addDays(TODAY, -10), 5), metric(TODAY, 7)]);
    const pts = buildMoodSeries(rows, 11, TODAY);
    expect(pts[0].moodAvg).toBe(5);
    expect(pts[6].moodAvg).toBe(5); // still within a week of the old entry
    expect(pts[7].moodAvg).toBeNull(); // a full week with nothing: the line breaks
    expect(pts[10].moodAvg).toBe(7);
  });

  it("marks best and worst days only when they differ", () => {
    const rows = parseDayRows([metric(addDays(TODAY, -1), 3), metric(TODAY, 9)]);
    const { best, worst } = bestAndWorstDay(buildMoodSeries(rows, 3, TODAY));
    expect(best?.mood).toBe(9);
    expect(worst?.mood).toBe(3);
    const flat = parseDayRows([metric(addDays(TODAY, -1), 5), metric(TODAY, 5)]);
    expect(bestAndWorstDay(buildMoodSeries(flat, 3, TODAY)).best).toBeNull();
  });
});

describe("week rhythm", () => {
  it("buckets mood by weekday with sample counts, and knows the usual", () => {
    const rows = parseDayRows([
      metric("2026-07-06", 8), // Mon
      metric("2026-07-13", 6), // Mon
      metric("2026-07-07", 3), // Tue
    ]);
    const byDay = moodByWeekday(rows);
    expect(byDay[0]).toEqual({ weekday: "Mon", avg: 7, n: 2 });
    expect(byDay[1]).toEqual({ weekday: "Tue", avg: 3, n: 1 });
    expect(byDay[2].n).toBe(0);
    expect(overallMood(rows)).toBeCloseTo(17 / 3);
  });

  it("bins capture times by hour", () => {
    const bins = captureHourHistogram(["2026-07-08T21:15:00.000+05:30", "2026-07-08T21:59:00.000+05:30", "2026-07-08T09:05:00.000+05:30"]);
    expect(bins[21].count).toBe(2);
    expect(bins[9].count).toBe(1);
  });
});

// Week w of the 8-week window that ends in TODAY's week (week 7 = 07-06).
const weekMon = (w: number) => addDays("2026-05-18", 7 * w);

/** perWeek entries in each listed week (Tue, Thu, …); `mentions` decides
 * which of them talk about "move". */
function history(weeks: number[], perWeek: number, mentions: (w: number, i: number) => boolean) {
  const days: ReturnType<typeof metric>[] = [];
  for (const w of weeks) {
    for (let i = 0; i < perWeek; i++) {
      const x = mentions(w, i) ? { themes: [{ key: "move", sentiment: 0 }] } : {};
      days.push(metric(addDays(weekMon(w), perWeek > 3 ? i : 1 + 2 * i), 5, x));
    }
  }
  return parseDayRows(days);
}

describe("themeStats", () => {
  it("counts, averages sentiment, and builds the 8-week sparkline", () => {
    const rows = parseDayRows([
      metric("2026-07-07", 5, { themes: [{ key: "Vendor Conflict", sentiment: -0.6 }] }),
      metric("2026-07-08", 5, { themes: [{ key: "vendor conflict", sentiment: -0.2 }] }),
    ]);
    const [t] = themeStats(rows, TODAY);
    expect(t.count).toBe(2);
    expect(t.sentiment).toBeCloseTo(-0.4);
    expect(t.spark[7]).toBe(2); // both in the current week
    expect(t.dates).toEqual(["2026-07-07", "2026-07-08"]);
    expect(t.lastSeen).toBe("2026-07-08");
  });

  it("flags a theme rising when it comes up on a much bigger share of recent entries", () => {
    // prior 5 weeks: 1 of 10 entries; last 2 weeks: 3 of 4
    const rows = history([0, 1, 2, 3, 4, 5, 6], 2, (w, i) => (w === 0 && i === 0) || w === 5 || (w === 6 && i === 0));
    expect(themeStats(rows, TODAY)[0].trend).toBe("rising");
  });

  it("flags a theme fading when it stops coming up", () => {
    const rows = history([0, 1, 2, 3, 4, 5, 6], 2, (w) => w <= 2);
    expect(themeStats(rows, TODAY)[0].trend).toBe("fading");
  });

  it("flags nothing until the history covers the whole comparison window", () => {
    // four weeks of use: the weeks before the first entry would count as zeros
    const rows = history([3, 4, 5, 6], 2, (w) => w >= 5);
    expect(themeStats(rows, TODAY)[0].trend).toBeNull();
  });

  it("does not call a topic rising just because you journaled more often", () => {
    // mentioned in every entry throughout — 1 entry a week before, 7 a week now
    const rows = parseDayRows([
      ...history([0, 1, 2, 3, 4], 1, () => true).map((r) => metric(r.date, 5, { themes: [{ key: "move", sentiment: 0 }] })),
      ...history([5, 6], 7, () => true).map((r) => metric(r.date, 5, { themes: [{ key: "move", sentiment: 0 }] })),
    ]);
    expect(themeStats(rows, TODAY)[0].trend).toBeNull();
  });

  it("trendOf reads shares, and stays quiet without enough history", () => {
    const spark = [0, 0, 0, 0, 0, 1, 1, 0];
    const entries = [1, 1, 1, 1, 1, 1, 1, 0];
    expect(trendOf(spark, entries, true)).toBe("rising");
    expect(trendOf(spark, entries, false)).toBeNull();
  });

  it("ranks this week's themes above ones that filled a month long ago", () => {
    const days: ReturnType<typeof metric>[] = [];
    for (let i = 60; i < 66; i++) days.push(metric(addDays(TODAY, -i), 5, { themes: [{ key: "old", sentiment: 0 }] }));
    for (const i of [1, 0]) days.push(metric(addDays(TODAY, -i), 5, { themes: [{ key: "new", sentiment: 0 }] }));
    expect(themeStats(parseDayRows(days), TODAY).map((t) => t.key)).toEqual(["new", "old"]);
  });
});

describe("peopleStats", () => {
  it("lists whoever came up most recently first, not who came up most", () => {
    const days = [30, 29, 28, 27].map((i) => metric(addDays(TODAY, -i), 5, { people: [{ key: "Priya", sentiment: 0 }] }));
    days.push(metric(addDays(TODAY, -1), 5, { people: [{ key: "Sam", sentiment: 0 }] }));
    expect(peopleStats(parseDayRows(days), TODAY).map((p) => p.key)).toEqual(["Sam", "Priya"]);
  });
});

describe("habits", () => {
  it("computes streaks and weekly totals", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -2), 6, { habits: [{ key: "gym", done: true }] }),
      metric(addDays(TODAY, -1), 6, { habits: [{ key: "gym", done: true }] }),
      metric(TODAY, 6, { habits: [{ key: "Gym", done: true }] }),
    ]);
    const d = habitDetail(rows, "gym", TODAY);
    expect(d.currentStreak).toBe(3);
    expect(d.doneDates.has(TODAY)).toBe(true);
    expect(d.weeklyTotals[3].done).toBe(3); // all in the current week (Mon 07-06)
  });

  it("streak survives an unlogged today", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -2), 6, { habits: [{ key: "gym", done: true }] }),
      metric(addDays(TODAY, -1), 6, { habits: [{ key: "gym", done: true }] }),
    ]);
    expect(habitDetail(rows, "gym", TODAY).currentStreak).toBe(2);
  });

  it("keeps a said-skipped day apart from a done day", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -1), 6, { habits: [{ key: "gym", done: true }] }),
      metric(TODAY, 6, { habits: [{ key: "gym", done: false }] }),
    ]);
    const d = habitDetail(rows, "gym", TODAY);
    expect(d.skippedDates.has(TODAY)).toBe(true);
    expect(d.doneDates.has(TODAY)).toBe(false);
    expect(d.lastDone).toBe(addDays(TODAY, -1));
  });

  it("holds the effect chip to the same bar as Mood movers (10 days a side, 0.8 gap)", () => {
    const alternating = (n: number) => {
      const days: ReturnType<typeof metric>[] = [];
      for (let i = 0; i < n; i++) {
        days.push(
          i % 2 === 0
            ? metric(addDays(TODAY, -i), 7, { habits: [{ key: "gym", done: true }] })
            : metric(addDays(TODAY, -i), 5),
        );
      }
      return parseDayRows(days);
    };
    expect(habitDetail(alternating(12), "gym", TODAY).effect).toBeNull(); // 6 vs 5 days
    const d = habitDetail(alternating(24), "gym", TODAY);
    expect(d.effect).toEqual({ withAvg: 7, withoutAvg: 5, nWith: 12, nWithout: 11 }); // day before gym ever appeared excluded
  });

  it("ignores tracked days from before the habit first appeared", () => {
    const days: ReturnType<typeof metric>[] = [];
    for (let i = 0; i < 12; i++) days.push(metric(addDays(TODAY, -i), 7, { habits: [{ key: "gym", done: true }] }));
    for (let i = 12; i < 24; i++) days.push(metric(addDays(TODAY, -i), 5));
    expect(habitDetail(parseDayRows(days), "gym", TODAY).effect).toBeNull();
  });

  it("lays out a calendar month with four distinct day states", () => {
    const rows = parseDayRows([
      metric("2026-07-02", 6, { habits: [{ key: "gym", done: true }] }),
      metric("2026-07-03", 6, { habits: [{ key: "gym", done: false }] }),
      metric("2026-07-06", 6),
    ]);
    const d = habitDetail(rows, "gym", TODAY);
    const journaled = new Set(rows.map((r) => r.date));
    const cells = habitMonthCells(d, journaled, "2026-07", TODAY);
    // 1 July 2026 is a Wednesday: two blanks (Mon, Tue) before it
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells).toHaveLength(2 + 31);
    const stateOf = (day: number) => cells[1 + day]?.state;
    expect(stateOf(2)).toBe("done");
    expect(stateOf(3)).toBe("skipped");
    expect(stateOf(6)).toBe("unmentioned"); // journaled, gym never came up
    expect(stateOf(8)).toBe("no-entry");
    expect(stateOf(10)).toBe("future");
  });

  it("lists discovered habits by frequency, minus dismissed ones", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -1), 5, { habits: [{ key: "gym", done: true }, { key: "meditation", done: true }] }),
      metric(TODAY, 5, { habits: [{ key: "gym", done: true }, { key: "meditation", done: false }] }),
    ]);
    expect(discoveredHabits(rows)).toEqual([
      { key: "gym", count: 2 },
      { key: "meditation", count: 1 },
    ]);
    expect(discoveredHabits(rows, new Set(["gym"]))).toEqual([{ key: "meditation", count: 1 }]);
  });
});

function alternatingGym(n: number, gymMood = 8, plainMood = 5) {
  const days: ReturnType<typeof metric>[] = [];
  for (let i = 0; i < n; i++) {
    days.push(
      i % 2 === 0
        ? metric(addDays(TODAY, -i), gymMood, { habits: [{ key: "gym", done: true }] })
        : metric(addDays(TODAY, -i), plainMood),
    );
  }
  return parseDayRows(days);
}

describe("moodMovers", () => {
  it("stays silent below n=10 per side", () => {
    const days: ReturnType<typeof metric>[] = [];
    for (let i = 0; i < 8; i++) days.push(metric(addDays(TODAY, -i), 8, { habits: [{ key: "gym", done: true }] }));
    for (let i = 8; i < 16; i++) days.push(metric(addDays(TODAY, -i), 4));
    expect(moodMovers(parseDayRows(days))).toHaveLength(0);
  });

  it("reports a habit finding as a plain sentence with counts", () => {
    const findings = moodMovers(alternatingGym(24));
    expect(findings[0].sentence).toBe("Days with gym average mood 8.0 vs 5.0 without (n=12/11).");
  });

  it("does not compare against days from before the habit existed", () => {
    const days: ReturnType<typeof metric>[] = [];
    for (let i = 0; i < 12; i++) days.push(metric(addDays(TODAY, -i), 8, { habits: [{ key: "gym", done: true }] }));
    for (let i = 12; i < 24; i++) days.push(metric(addDays(TODAY, -i), 5));
    const sameDay = moodMovers(parseDayRows(days)).filter((f) => f.sentence.startsWith("Days with gym"));
    expect(sameDay).toHaveLength(0);
  });

  it("reports next-day relationships", () => {
    const nextDay = moodMovers(alternatingGym(24)).find((f) => f.sentence.startsWith("The day after"));
    expect(nextDay?.sentence).toBe("The day after gym, mood averages 5.0 vs 8.0 after days without (n=11/11).");
  });

  it("leaves dismissed habits out entirely", () => {
    const findings = moodMovers(alternatingGym(24), new Set(["gym"]));
    expect(findings.some((f) => f.sentence.includes("gym"))).toBe(false);
  });

  it("links low-mood days to short sleep only when that beats their usual", () => {
    const days: ReturnType<typeof metric>[] = [];
    for (let i = 0; i < 5; i++) days.push(metric(addDays(TODAY, -i), 2, { sleep_hours: 5 }));
    for (let i = 5; i < 15; i++) days.push(metric(addDays(TODAY, -i), 8, { sleep_hours: 8 }));
    const sleepFinding = moodMovers(parseDayRows(days)).find((f) => f.sentence.includes("short sleep"));
    expect(sleepFinding?.sentence).toBe(
      "Your 5 lowest-mood days: 5 followed short sleep (under 6h) — that happened on 33% of the 15 days you mentioned sleep.",
    );
  });

  it("says nothing about sleep when short nights are simply normal for them", () => {
    const days: ReturnType<typeof metric>[] = [];
    for (let i = 0; i < 15; i++) days.push(metric(addDays(TODAY, -i), 2 + (i % 7), { sleep_hours: 5 }));
    expect(moodMovers(parseDayRows(days)).some((f) => f.sentence.includes("short sleep"))).toBe(false);
  });
});

describe("emotionCounts / unlocks", () => {
  it("counts emotions case-insensitively within the window", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -1), 5, { emotions: ["Frustrated", "proud"] }),
      metric(TODAY, 5, { emotions: ["frustrated"] }),
      metric(addDays(TODAY, -60), 5, { emotions: ["frustrated"] }),
    ]);
    const recent = emotionCounts(rows, addDays(TODAY, -27));
    expect(recent).toEqual([
      { emotion: "frustrated", count: 2 },
      { emotion: "proud", count: 1 },
    ]);
    expect(emotionCounts(rows, null)[0].count).toBe(3);
  });

  it("folds noun forms into their adjective ('anxiety' + 'anxious' = one bar)", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -1), 5, { emotions: ["anxiety"] }),
      metric(TODAY, 5, { emotions: ["anxious", "frustration"] }),
    ]);
    expect(emotionCounts(rows, null)).toEqual([
      { emotion: "anxious", count: 2 },
      { emotion: "frustrated", count: 1 },
    ]);
  });

  it("keeps the user's own words apart from the AI's labels", () => {
    const rows = parseDayRows([
      metric(addDays(TODAY, -1), 5, { emotions: ["frustrated"], emotions_named: ["ugh", "drained"] }),
      metric(TODAY, 5, { emotions: ["tired"] }), // extracted before words were recorded
    ]);
    expect(emotionCounts(rows, null, "named")).toEqual([
      { emotion: "ugh", count: 1 },
      { emotion: "drained", count: 1 },
    ]);
    expect(countDaysWithNamedEmotions(rows)).toBe(1);
  });

  it("gates modules on entry counts and week span", () => {
    const u = computeUnlocks(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]);
    expect(u.moodChart).toBe(true);
    expect(u.themes).toBe(false);
    expect(u.weekRhythm).toBe(false); // 5 days within 1-2 weeks
    expect(computeUnlocks(["2026-06-17", "2026-06-24", "2026-07-01"]).weekRhythm).toBe(false); // 3 weeks, 3 days
    const fourteen = Array.from({ length: 14 }, (_, i) => addDays("2026-06-21", i)); // spans 3 weeks
    expect(computeUnlocks(fourteen).weekRhythm).toBe(true);
  });
});

describe("monthStats", () => {
  it("computes the month's numbers and its best week", () => {
    const rows = parseDayRows([
      metric("2026-07-31", 1), // outside the month
      metric("2026-08-03", 6, { themes: [{ key: "exam", sentiment: 0 }] }),
      metric("2026-08-04", 8, { themes: [{ key: "Exam", sentiment: 0 }] }),
      metric("2026-08-12", 4, { themes: [{ key: "sleep", sentiment: 0 }] }),
      metric("2026-08-13", 5),
    ]);
    expect(monthStats(rows, "2026-08")).toEqual({
      month: "2026-08",
      daysJournaled: 4,
      avgMood: 5.75,
      avgEnergy: null,
      topTheme: { key: "exam", count: 2 },
      bestWeek: { weekStart: "2026-08-03", avgMood: 7, days: 2 },
    });
  });
});
