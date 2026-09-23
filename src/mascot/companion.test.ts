import { describe, expect, it } from "vitest";
import { insightLines } from "./companion";
import type { Slide } from "../insights/recap";

describe("insightLines", () => {
  it("turns the recap's findings into sentences, leaving out the framing", () => {
    const slides: Slide[] = [
      { kind: "open", from: "2026-09-17", to: "2026-09-23", written: 5, days: 7 },
      { kind: "mood", avg: 6.7, prevAvg: 7.3, energyAvg: null, series: [] },
      { kind: "theme", key: "running", count: 4, rest: [] },
      { kind: "streak", days: 12 },
      { kind: "close", notes: 0, suggestion: null },
    ];
    expect(insightLines(slides, "week")).toEqual([
      "Your mood this week averages 6.7 out of 10, down 0.6 on last week.",
      "“running” came up on 4 days this week.",
    ]);
  });

  it("says nothing about a trend too small to mean anything", () => {
    const slides: Slide[] = [{ kind: "mood", avg: 6.0, prevAvg: 5.9, energyAvg: null, series: [] }];
    expect(insightLines(slides, "month")).toEqual(["Your mood this month averages 6.0 out of 10."]);
  });
});
