import { describe, expect, it } from "vitest";
import { daysInMonth, topicMonth } from "./topicMonth";
import type { DayRow } from "./stats";

function day(date: string, mood: number | null, themes: { key: string; sentiment: number }[] = [], people: { key: string; sentiment: number }[] = []): DayRow {
  return {
    date,
    mood,
    energy: null,
    summaryLine: `about ${date}`,
    x: { themes, people, habits: [], activities: [] },
  } as unknown as DayRow;
}

describe("topicMonth", () => {
  it("counts the days in a month", () => {
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2028-02")).toBe(29);
  });

  it("marks the days a name came up, with its mood and feeling", () => {
    const rows = [
      day("2026-08-03", 6, [{ key: "Sleep", sentiment: -0.5 }]),
      day("2026-08-04", 7),
      day("2026-08-10", 5, [{ key: "sleep", sentiment: -0.3 }, { key: "SLEEP", sentiment: -0.1 }]),
    ];
    const days = topicMonth(rows, "themes", "sleep", "2026-08", "2026-09-19");
    expect(days).toHaveLength(31);
    expect(days[2]).toMatchObject({ date: "2026-08-03", journaled: true, mentioned: true, mood: 6 });
    expect(days[2].sentiment).toBeCloseTo(-0.5);
    expect(days[3]).toMatchObject({ journaled: true, mentioned: false, sentiment: null });
    expect(days[9].sentiment).toBeCloseTo(-0.2);
    expect(days[4]).toMatchObject({ journaled: false, mentioned: false, mood: null });
  });

  it("stops at today in the current month, and reads the right group", () => {
    const rows = [day("2026-09-02", 6, [], [{ key: "Sam", sentiment: 0.4 }])];
    const days = topicMonth(rows, "people", "Sam", "2026-09", "2026-09-19");
    expect(days).toHaveLength(19);
    expect(days[1].mentioned).toBe(true);
    expect(topicMonth(rows, "themes", "Sam", "2026-09", "2026-09-19")[1].mentioned).toBe(false);
  });
});
