import { describe, expect, it } from "vitest";
import { discoveredHabits, isCurrent, recentRows, type DayRow } from "./stats";
import { activityStats } from "./activation";

function row(date: string, extra: Partial<DayRow["x"]> = {}): DayRow {
  return {
    date,
    mood: 5,
    energy: 5,
    summaryLine: null,
    x: {
      themes: [], habits: [], people: [], emotions: [], emotionsNamed: null, sleep_hours: null,
      moodSource: null, activities: [], thinkingTraps: [],
      rhythm: { firstContact: null, workStart: null, dinner: null },
      ...extra,
    },
  };
}

describe("keeping Patterns current", () => {
  it("someone last mentioned over a month ago is no longer current", () => {
    expect(isCurrent("2026-09-01", "2026-09-23")).toBe(true);
    expect(isCurrent("2026-08-24", "2026-09-23")).toBe(true);
    expect(isCurrent("2026-08-23", "2026-09-23")).toBe(false);
  });

  it("comparisons look at the last three months only", () => {
    const rows = [row("2026-06-01"), row("2026-06-25"), row("2026-09-20")];
    expect(recentRows(rows, "2026-09-23").map((r) => r.date)).toEqual(["2026-06-25", "2026-09-20"]);
  });

  it("a habit not done in the last month is not offered for pinning", () => {
    const gym = [{ key: "gym", done: true }];
    const walk = [{ key: "walk", done: true }];
    const rows = [row("2026-07-01", { habits: gym }), row("2026-07-02", { habits: gym }), row("2026-09-20", { habits: walk })];
    expect(discoveredHabits(rows, new Set(), "2026-08-24")).toEqual([{ key: "walk", count: 1 }]);
  });

  it("an activity not done since the cut-off drops out", () => {
    const swim = [{ key: "swim", pleasure: 2, mastery: 1 }];
    const read = [{ key: "read", pleasure: 2, mastery: 1 }];
    const rows = [
      row("2026-07-01", { activities: swim }), row("2026-07-03", { activities: swim }),
      row("2026-09-01", { activities: read }), row("2026-09-20", { activities: read }),
    ];
    expect(activityStats(rows, "2026-08-24").map((a) => a.key)).toEqual(["read"]);
    expect(activityStats(rows).map((a) => a.key).sort()).toEqual(["read", "swim"]);
  });
});
