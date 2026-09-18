import { describe, expect, it } from "vitest";
import {
  computeNeglectedDomains,
  formatObservationLine,
  formatOpenThreads,
  formatTopObservations,
  selectOpenThreads,
} from "./memory";
import type { Observation } from "../db/types";

function obs(partial: Partial<Observation>): Observation {
  return {
    id: 1,
    kind: "habit",
    key: "gym",
    detail: null,
    sentiment: null,
    occurrences: 1,
    first_seen: "2026-07-01",
    last_seen: "2026-07-01",
    pinned: 0,
    ...partial,
  };
}

describe("formatObservationLine", () => {
  it("renders the observation line shape", () => {
    const line = formatObservationLine(
      obs({ kind: "habit", key: "gym", occurrences: 12, last_seen: "2026-07-04", sentiment: 0.5 }),
    );
    expect(line).toBe("habit:gym — 12×, last 2026-07-04, positive");
  });

  it("omits the sentiment word when sentiment is unknown", () => {
    const line = formatObservationLine(obs({ sentiment: null }));
    expect(line).toBe("habit:gym — 1×, last 2026-07-01");
  });

  it("labels near-zero sentiment as mixed and negative as negative", () => {
    expect(formatObservationLine(obs({ sentiment: 0.05 }))).toContain("mixed");
    expect(formatObservationLine(obs({ sentiment: -0.6 }))).toContain("negative");
  });
});

describe("formatTopObservations", () => {
  it("is empty-safe", () => {
    expect(formatTopObservations([])).toBe("(none recorded yet)");
  });
});

describe("computeNeglectedDomains", () => {
  const dayWith = (x: object) => ({ raw_json: JSON.stringify(x) });

  it("returns nothing for a brand-new user (no history to be neglected)", () => {
    expect(computeNeglectedDomains([])).toEqual([]);
  });

  it("flags domains with no evidence in the recent window", () => {
    const recent = [
      dayWith({ people: [{ key: "Priya", sentiment: 0.3 }] }),
      dayWith({ people: [{ key: "boss", sentiment: -0.2 }] }),
    ];
    const neglected = computeNeglectedDomains(recent);
    expect(neglected).toContain("body (sleep, food, movement)");
    expect(neglected).toContain("worries & loose ends");
    expect(neglected).not.toContain("people (who they interacted with)");
  });

  it("considers a domain covered if ANY recent day touched it", () => {
    const recent = [dayWith({}), dayWith({ sleep_hours: 7 })];
    expect(computeNeglectedDomains(recent)).not.toContain("body (sleep, food, movement)");
  });
});

describe("selectOpenThreads", () => {
  const today = "2026-07-09";

  it("keeps only recent struggles, newest first, capped at 3", () => {
    const threads = selectOpenThreads(
      [
        obs({ kind: "struggle", key: "a", last_seen: "2026-07-08" }),
        obs({ kind: "struggle", key: "old", last_seen: "2026-06-01" }),
        obs({ kind: "struggle", key: "b", last_seen: "2026-07-05" }),
        obs({ kind: "struggle", key: "c", last_seen: "2026-07-06" }),
        obs({ kind: "struggle", key: "d", last_seen: "2026-07-07" }),
        obs({ kind: "habit", key: "gym", last_seen: "2026-07-08" }),
      ],
      today,
    );
    expect(threads.map((t) => t.key)).toEqual(["a", "d", "c"]);
  });

  it("renders empty-safe", () => {
    expect(formatOpenThreads([])).toBe("(none)");
    expect(
      formatOpenThreads([obs({ kind: "struggle", key: "ruminating", last_seen: "2026-07-08" })]),
    ).toBe("- ruminating (last came up 2026-07-08)");
  });
});
