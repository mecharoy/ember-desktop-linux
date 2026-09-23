import { describe, expect, it } from "vitest";
import { buildRecap, type RecapInput } from "./recap";
import type { DayRow } from "./stats";
import type { CheckIn } from "../db/types";

function row(date: string, mood: number | null, extra: Partial<DayRow["x"]> = {}): DayRow {
  return {
    date,
    mood,
    energy: mood,
    summaryLine: `line for ${date}`,
    x: {
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
      ...extra,
    },
  };
}

function checkin(date: string, sleep: number | null, bedtime: string | null): CheckIn {
  return {
    date,
    mood: null,
    energy: null,
    sleep_hours: sleep,
    feeling: null,
    on_mind: null,
    habits: "{}",
    created_at: `${date}T20:00:00`,
    updated_at: `${date}T20:00:00`,
    bedtime,
    wake_time: null,
    sleep_latency_min: null,
    sleep_quality: null,
    lunch: null,
    evening_break: null,
    dinner: null,
  } as CheckIn;
}

const base = (over: Partial<RecapInput>): RecapInput => ({
  period: "week",
  today: "2026-09-23",
  rows: [],
  entries: [],
  checkins: [],
  captureTimes: [],
  streak: 0,
  suggestions: [],
  ...over,
});

const kinds = (input: RecapInput) => buildRecap(input).map((s) => s.kind);

describe("buildRecap", () => {
  it("with nothing to go on, only opens and closes", () => {
    expect(kinds(base({}))).toEqual(["open", "close"]);
  });

  it("covers the last 7 days for a week, including today", () => {
    const open = buildRecap(base({})).find((s) => s.kind === "open");
    expect(open).toMatchObject({ from: "2026-09-17", to: "2026-09-23", days: 7 });
  });

  it("needs three rated days before it says anything about mood", () => {
    const two = [row("2026-09-22", 6), row("2026-09-23", 7)];
    expect(kinds(base({ rows: two }))).not.toContain("mood");
    const three = [...two, row("2026-09-21", 5)];
    const mood = buildRecap(base({ rows: three })).find((s) => s.kind === "mood");
    expect(mood).toMatchObject({ avg: 6, prevAvg: null });
  });

  it("compares mood with the week before when that week has enough days", () => {
    const rows = [
      row("2026-09-14", 4), row("2026-09-15", 4), row("2026-09-16", 4),
      row("2026-09-21", 6), row("2026-09-22", 6), row("2026-09-23", 6),
    ];
    const mood = buildRecap(base({ rows })).find((s) => s.kind === "mood");
    expect(mood).toMatchObject({ avg: 6, prevAvg: 4 });
  });

  it("picks the best day among days with an entry, and its title", () => {
    const rows = [row("2026-09-20", 9), row("2026-09-21", 7), row("2026-09-22", 5)];
    const entries = [{ date: "2026-09-21", title: "Good run" }, { date: "2026-09-22", title: "Rain" }];
    const best = buildRecap(base({ rows, entries })).find((s) => s.kind === "bestDay");
    // 09-20 had the highest mood but no entry, so it isn't the one shown.
    expect(best).toMatchObject({ date: "2026-09-21", title: "Good run", mood: 7 });
  });

  it("names a top theme only when it came up at least twice", () => {
    const once = [row("2026-09-22", 5, { themes: [{ key: "Running", sentiment: 1 }] })];
    expect(kinds(base({ rows: once }))).not.toContain("theme");
    const twice = [...once, row("2026-09-23", 5, { themes: [{ key: "running", sentiment: 1 }] })];
    expect(buildRecap(base({ rows: twice })).find((s) => s.kind === "theme")).toMatchObject({ key: "running", count: 2 });
  });

  it("prefers the person's own feeling words over Elytra's labels", () => {
    const rows = [
      row("2026-09-22", 5, { emotions: ["anxiety", "anxious"], emotionsNamed: ["wired", "wired"] }),
      row("2026-09-23", 5, { emotions: ["anxious"], emotionsNamed: [] }),
    ];
    const f = buildRecap(base({ rows })).find((s) => s.kind === "feelings");
    expect(f).toMatchObject({ own: true, words: [{ word: "wired", count: 2 }] });
  });

  it("finds the activity that lifted mood, ignoring small differences", () => {
    const walk = [{ key: "long walk", pleasure: 2, mastery: 1 }];
    const rows = [
      row("2026-09-18", 8, { activities: walk }), row("2026-09-19", 8, { activities: walk }),
      row("2026-09-20", 5), row("2026-09-21", 5),
    ];
    expect(buildRecap(base({ rows })).find((s) => s.kind === "lift")).toMatchObject({
      activity: "long walk", withAvg: 8, withoutAvg: 5, days: 2,
    });
  });

  it("reads a bedtime after midnight as later, not earlier", () => {
    const checkins = [
      checkin("2026-09-21", 7, "23:30"), checkin("2026-09-22", 6, "00:30"), checkin("2026-09-23", 8, "01:00"),
    ];
    expect(buildRecap(base({ checkins })).find((s) => s.kind === "sleep")).toMatchObject({
      avgHours: 7, nights: 3, bedtime: "00:30",
    });
  });

  it("counts only notes inside the period, and carries the first suggestion", () => {
    const slides = buildRecap(
      base({ captureTimes: ["2026-09-10T09:00:00", "2026-09-23T09:00:00"], suggestions: ["Morning walk"] }),
    );
    const close = slides[slides.length - 1];
    expect(close).toEqual({ kind: "close", notes: 1, suggestion: "Morning walk" });
  });

  it("a month looks back 30 days", () => {
    const open = buildRecap(base({ period: "month" })).find((s) => s.kind === "open");
    expect(open).toMatchObject({ from: "2026-08-25", days: 30 });
  });
});
