import { describe, expect, it } from "vitest";
import {
  bandFor,
  displayScore,
  dueInstruments,
  formatAssessmentsForPrompt,
  INSTRUMENTS,
  isComplete,
  needsCare,
  parseEnabledInstruments,
  rawScore,
} from "./assessments";

describe("instrument definitions", () => {
  it("have the published number of items and answer ranges", () => {
    expect(INSTRUMENTS.who5.items).toHaveLength(5);
    expect(INSTRUMENTS.phq9.items).toHaveLength(9);
    expect(INSTRUMENTS.gad7.items).toHaveLength(7);
    for (const def of Object.values(INSTRUMENTS)) {
      const top = Math.max(...def.options.map((o) => o.value));
      expect(top * def.items.length).toBe(def.maxRaw);
    }
  });
});

describe("scoring and bands", () => {
  it("shows WHO-5 as a percentage and flags below 50", () => {
    expect(displayScore("who5", 13)).toBe(52);
    expect(bandFor("who5", 13).worthALook).toBe(false);
    expect(bandFor("who5", 12)).toEqual({ label: "low", worthALook: true }); // 48
  });

  it("uses the PHQ-9 bands, with 10 as the closer-look point", () => {
    expect(bandFor("phq9", 4).label).toBe("minimal");
    expect(bandFor("phq9", 9)).toEqual({ label: "mild", worthALook: false });
    expect(bandFor("phq9", 10)).toEqual({ label: "moderate", worthALook: true });
    expect(bandFor("phq9", 15).label).toBe("moderately severe");
    expect(bandFor("phq9", 20).label).toBe("severe");
  });

  it("uses the GAD-7 bands", () => {
    expect(bandFor("gad7", 5).label).toBe("mild");
    expect(bandFor("gad7", 14).label).toBe("moderate");
    expect(bandFor("gad7", 15).label).toBe("severe");
  });

  it("sums the answers", () => {
    expect(rawScore([1, 2, 3])).toBe(6);
  });
});

describe("needsCare", () => {
  it("fires on any PHQ-9 item-9 answer above zero, whatever the total", () => {
    const low = [0, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(rawScore(low)).toBe(1);
    expect(needsCare("phq9", low)).toBe(true);
    expect(needsCare("phq9", [3, 3, 3, 3, 3, 3, 3, 3, 0])).toBe(false);
    expect(needsCare("gad7", [3, 3, 3, 3, 3, 3, 3])).toBe(false);
  });
});

describe("isComplete", () => {
  it("wants one in-range answer per item", () => {
    expect(isComplete("who5", [5, 4, 3, 2, 1])).toBe(true);
    expect(isComplete("who5", [5, 4, 3, 2, null])).toBe(false);
    expect(isComplete("gad7", [0, 1, 2, 3, 4, 0, 0])).toBe(false); // 4 is not a GAD-7 answer
  });
});

describe("dueInstruments", () => {
  const taken = [
    { instrument: "who5" as const, date: "2026-09-01" },
    { instrument: "phq9" as const, date: "2026-09-10" },
  ];

  it("offers what was never taken or was taken 14+ days ago", () => {
    expect(dueInstruments(["who5", "phq9", "gad7"], taken, "2026-09-15", "")).toEqual(["who5", "gad7"]);
    expect(dueInstruments(["who5"], taken, "2026-09-14", "")).toEqual([]);
  });

  it("offers nothing that is not opted into, or while snoozed", () => {
    expect(dueInstruments(["phq9"], taken, "2026-09-15", "")).toEqual([]);
    expect(dueInstruments(["who5", "gad7"], taken, "2026-09-15", "2026-09-16")).toEqual([]);
    expect(dueInstruments(["who5", "gad7"], taken, "2026-09-16", "2026-09-16")).toEqual(["who5", "gad7"]);
  });
});

describe("parseEnabledInstruments", () => {
  it("keeps known ids in a fixed order", () => {
    expect(parseEnabledInstruments("gad7, who5,nonsense")).toEqual(["who5", "gad7"]);
    expect(parseEnabledInstruments("")).toEqual([]);
  });
});

describe("formatAssessmentsForPrompt", () => {
  it("carries totals and bands only, never item answers", () => {
    const text = formatAssessmentsForPrompt([
      { instrument: "who5", date: "2026-09-01", score: 11 },
      { instrument: "phq9", date: "2026-09-01", score: 12 },
    ]);
    expect(text).toBe(
      ["- 2026-09-01: WHO-5 Well-Being Index 44/100 (low)", "- 2026-09-01: PHQ-9 12/27 (moderate)"].join("\n"),
    );
    expect(formatAssessmentsForPrompt([])).toBe("(none taken)");
  });
});
