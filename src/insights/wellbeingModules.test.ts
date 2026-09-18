import { describe, expect, it } from "vitest";
import type { DayExtraction, DayRow } from "./stats";
import { addDays, parseDayRows } from "./stats";
import { groundThinkingTraps, normaliseTrapType, thinkingTrapStats } from "./thinking";
import { activityStats, enjoymentPullBack, knownActivityNames } from "./activation";
import { formatClock, nightFrom, nightMinutes, parseClock, sleepSummary, type DiaryRow } from "./sleep";
import { HIT_WINDOW_MIN, routineSummary, weekScore } from "./routine";

const EMPTY: DayExtraction = {
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

function day(date: string, mood: number | null, x: Partial<DayExtraction> = {}): DayRow {
  return { date, mood, energy: null, summaryLine: null, x: { ...EMPTY, ...x } };
}

function diary(date: string, d: Partial<DiaryRow> = {}): DiaryRow {
  return { date, bedtime: null, wake_time: null, sleep_hours: null, sleep_latency_min: null, sleep_quality: null, ...d };
}

describe("parseDayRows (new fields)", () => {
  it("reads activities, traps and routine times, and tolerates their absence", () => {
    const [withFields, without] = parseDayRows([
      {
        date: "2026-09-01",
        mood: 5,
        energy: 5,
        summary_line: null,
        raw_json: JSON.stringify({
          activities: [{ key: "walk", pleasure: 3, mastery: 7 }],
          thinking_traps: [{ type: "catastrophising", quote: "ruined" }],
          rhythm: { first_contact: "08:30", work_start: "nine", dinner: "20:00" },
        }),
      },
      { date: "2026-09-02", mood: 5, energy: 5, summary_line: null, raw_json: "{}" },
    ]);
    expect(withFields.x.activities).toEqual([{ key: "walk", pleasure: 3, mastery: null }]); // 7 is out of range
    expect(withFields.x.thinkingTraps).toHaveLength(1);
    expect(withFields.x.rhythm).toEqual({ firstContact: "08:30", workStart: null, dinner: "20:00" });
    expect(without.x.activities).toEqual([]);
    expect(without.x.rhythm.dinner).toBeNull();
  });
});

describe("thinking traps", () => {
  it("maps common spellings onto the known types", () => {
    expect(normaliseTrapType("Catastrophizing")).toBe("catastrophising");
    expect(normaliseTrapType("black-and-white")).toBe("all_or_nothing");
    expect(normaliseTrapType("should statements")).toBe("should_statements");
    expect(normaliseTrapType("mind reading")).toBe("mind_reading");
    expect(normaliseTrapType("vibes")).toBeNull();
  });

  it("keeps a trap only when its quote is in what the user typed", () => {
    const said = "Honestly I’m sure they all think I’m useless.\nThis will   ruin everything.";
    const kept = groundThinkingTraps(
      [
        { type: "mind reading", quote: "I'm sure they all think I'm useless" }, // straight vs curly quotes
        { type: "catastrophizing", quote: '"this will ruin everything"' }, // whitespace + wrapping quotes
        { type: "labelling", quote: "I am an idiot" }, // never said
        { type: "nonsense", quote: "ruin everything" }, // unknown type
        { type: "catastrophising", quote: "this will ruin everything" }, // same quote twice
      ],
      said,
    );
    expect(kept.map((t) => t.type)).toEqual(["mind_reading", "catastrophising"]);
  });

  it("ranks traps by recent days and names the themes they cluster around", () => {
    const rows = [
      day("2026-06-01", 5, { thinkingTraps: [{ type: "catastrophising", quote: "a" }], themes: [{ key: "exam", sentiment: -0.5 }] }), // outside 8 weeks
      day("2026-09-01", 5, { thinkingTraps: [{ type: "catastrophising", quote: "b" }], themes: [{ key: "Exam", sentiment: -0.5 }] }),
      day("2026-09-02", 5, {
        thinkingTraps: [
          { type: "mind_reading", quote: "c" },
          { type: "mind_reading", quote: "d" },
        ],
      }),
      day("2026-09-03", 5, { thinkingTraps: [{ type: "mind_reading", quote: "e" }] }),
      day("2026-09-04", 5, { thinkingTraps: [{ type: "labelling", quote: "f" }] }), // once: below the bar
    ];
    const stats = thinkingTrapStats(rows, "2026-09-10");
    expect(stats.map((s) => [s.trap.id, s.days, s.recentDays])).toEqual([
      ["mind_reading", 2, 2],
      ["catastrophising", 2, 1],
    ]);
    expect(stats[0].examples[0]).toEqual({ date: "2026-09-03", quote: "e" });
    expect(stats[1].themes).toEqual(["exam"]);
  });
});

describe("activities", () => {
  it("averages enjoyment and achievement over the days they were rated", () => {
    const rows = [
      day("2026-09-01", 6, { activities: [{ key: "Walk", pleasure: 3, mastery: null }] }),
      day("2026-09-02", 6, { activities: [{ key: "walk", pleasure: 1, mastery: 2 }] }),
      day("2026-09-03", 6, { activities: [{ key: "chess", pleasure: 2, mastery: 2 }] }),
    ];
    const [walk] = activityStats(rows);
    expect(walk.key).toBe("Walk");
    expect(walk.days).toBe(2);
    expect(walk.pleasure).toEqual({ avg: 2, n: 2 });
    expect(walk.mastery).toEqual({ avg: 2, n: 1 });
    expect(activityStats(rows).map((a) => a.key)).toEqual(["Walk"]); // chess: one day only
    expect(knownActivityNames(rows)).toEqual(["Walk", "chess"]);
  });

  it("reports a mood difference only past the shared bar", () => {
    const rows: DayRow[] = [];
    for (let i = 0; i < 12; i++) rows.push(day(addDays("2026-08-01", i), 8, { activities: [{ key: "run", pleasure: 2, mastery: 2 }] }));
    for (let i = 12; i < 24; i++) rows.push(day(addDays("2026-08-01", i), 5));
    expect(activityStats(rows)[0].moodEffect).toEqual({ withAvg: 8, withoutAvg: 5, nWith: 12, nWithout: 12 });
  });

  it("shows a plain mood comparison from three days a side, even below the bar", () => {
    const rows: DayRow[] = [];
    for (let i = 0; i < 3; i++) rows.push(day(addDays("2026-08-01", i), 7, { activities: [{ key: "walk", pleasure: 2, mastery: 2 }] }));
    for (let i = 3; i < 6; i++) rows.push(day(addDays("2026-08-01", i), 6));
    const [walk] = activityStats(rows);
    expect(walk.moodOn).toEqual({ withAvg: 7, withoutAvg: 6, nWith: 3, nWithout: 3 });
    expect(walk.moodEffect).toBeNull();
  });

  it("flags a clear pull-back from enjoyable things, and only a clear one", () => {
    const today = "2026-09-30";
    const rows: DayRow[] = [];
    for (let i = 42; i > 14; i -= 2) rows.push(day(addDays(today, -i), 6, { activities: [{ key: "guitar", pleasure: 3, mastery: 1 }, { key: "friends", pleasure: 2, mastery: null }] }));
    for (let i = 14; i > 0; i -= 2) rows.push(day(addDays(today, -i), 5, { activities: [{ key: "work", pleasure: 0, mastery: 2 }] }));
    const pb = enjoymentPullBack(rows, today)!;
    expect(pb.beforePerDay).toBe(2);
    expect(pb.recentPerDay).toBe(0);

    const steady = rows.map((r) => ({ ...r, x: { ...r.x, activities: [{ key: "guitar", pleasure: 3, mastery: 1 }] } }));
    expect(enjoymentPullBack(steady, today)).toBeNull();
  });
});

describe("sleep diary", () => {
  it("reads clocks and keeps after-midnight bedtimes on the same night", () => {
    expect(parseClock("7:05")).toBe(425);
    expect(parseClock("25:00")).toBeNull();
    expect(nightMinutes(30)).toBe(24 * 60 + 30);
    expect(formatClock(24 * 60 + 30)).toBe("00:30");
  });

  it("works out time in bed, time asleep and efficiency for a night", () => {
    const n = nightFrom(diary("2026-09-02", { bedtime: "23:30", wake_time: "07:30", sleep_hours: 6.8, sleep_latency_min: 40 }));
    expect(n.inBedMin).toBe(480);
    expect(n.asleepMin).toBeCloseTo(408);
    expect(n.efficiency).toBeCloseTo(0.85);
    const noHours = nightFrom(diary("2026-09-02", { bedtime: "00:15", wake_time: "07:15", sleep_latency_min: 60 }));
    expect(noHours.inBedMin).toBe(420);
    expect(noHours.asleepMin).toBe(360);
    expect(noHours.efficiency).toBeNull(); // needs their own hours to mean anything
  });

  it("summarises the last four weeks and raises the sleep-therapy findings", () => {
    const today = "2026-09-30";
    const rows: DiaryRow[] = [];
    for (let i = 1; i <= 10; i++) {
      rows.push(
        diary(addDays(today, -i), {
          bedtime: i % 2 === 0 ? "22:00" : "01:00",
          wake_time: "08:00",
          sleep_hours: 6,
          sleep_latency_min: 45,
          sleep_quality: 2,
        }),
      );
    }
    const s = sleepSummary(rows, [], today);
    expect(s.timedNights).toBe(10);
    expect(s.usualBed).toBe("23:30");
    expect(s.bedSpreadMin).toBe(90);
    expect(s.avgAsleepH).toBe(6);
    const text = s.findings.map((f) => f.sentence).join(" | ");
    expect(text).toContain("30 minutes or more to fall asleep on 10 of the 10 nights");
    expect(text).toMatch(/asleep for about \d+% of your time in bed/);
    expect(text).toContain("±90 minutes");
  });
});

describe("daily routine", () => {
  it("scores a week the SRM-5 way: hits within 45 minutes of the week's usual time", () => {
    const week = Array.from({ length: 7 }, (_, k) => addDays("2026-09-07", k));
    const diaryByDate = new Map<string, DiaryRow>();
    // Up at 07:00 six days, 10:00 once (a miss). No other anchors.
    week.forEach((d, k) => diaryByDate.set(d, diary(d, { wake_time: k === 6 ? "10:00" : "07:00" })));
    const { score, anchorsCounted } = weekScore(week, new Map(), diaryByDate);
    expect(anchorsCounted).toBe(1);
    // usual = 07:26; 07:00 is 26 min away (hit), 10:00 is 154 away (miss)
    expect(score).toBe(6);
    expect(HIT_WINDOW_MIN).toBe(45);
  });

  it("uses tomorrow's check-in bedtime for tonight, and ignores anchors seen on under 3 days", () => {
    const week = Array.from({ length: 7 }, (_, k) => addDays("2026-09-07", k));
    const diaryByDate = new Map<string, DiaryRow>();
    for (const d of [...week, "2026-09-14"]) diaryByDate.set(d, diary(d, { bedtime: "23:45" }));
    const rowsByDate = new Map([["2026-09-08", day("2026-09-08", 5, { rhythm: { firstContact: "09:00", workStart: null, dinner: null } })]]);
    const { score, anchorsCounted } = weekScore(week, rowsByDate, diaryByDate);
    expect(anchorsCounted).toBe(1); // bed only — first contact on one day doesn't count
    expect(score).toBe(7);
  });

  it("summarises recent weeks and anchors", () => {
    const today = "2026-09-30";
    const d: DiaryRow[] = [];
    for (let i = 1; i <= 20; i++) d.push(diary(addDays(today, -i), { wake_time: "07:00" }));
    const s = routineSummary([], d, today, 4);
    expect(s.weeks).toHaveLength(4);
    expect(s.latest?.score).toBe(7);
    expect(s.anchors.find((a) => a.id === "wake")).toMatchObject({ usual: "07:00", hits: 20, days: 20 });
    expect(s.finding).toBeNull();
  });
});
