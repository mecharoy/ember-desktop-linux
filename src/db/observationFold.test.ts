import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  foldMetricsIntoObservations,
  observationScore,
} from "./observationFold";
import type { Observation } from "./types";

const day = (date: string, x: object) => ({ date, raw_json: JSON.stringify(x) });

describe("foldMetricsIntoObservations", () => {
  it("merges keys case-insensitively, keeping first-seen casing", () => {
    const rows = [
      day("2026-07-01", { people: [{ key: "Priya", sentiment: 0.5 }] }),
      day("2026-07-02", { people: [{ key: "priya", sentiment: -0.5 }] }),
    ];
    const [o] = foldMetricsIntoObservations(rows);
    expect(o.key).toBe("Priya");
    expect(o.occurrences).toBe(2);
    expect(o.first_seen).toBe("2026-07-01");
    expect(o.last_seen).toBe("2026-07-02");
  });

  it("averages sentiment over the days it was present", () => {
    const rows = [
      day("2026-07-01", { themes: [{ key: "vendor conflict", sentiment: -0.6 }] }),
      day("2026-07-02", { themes: [{ key: "vendor conflict", sentiment: -0.2 }] }),
    ];
    const [o] = foldMetricsIntoObservations(rows);
    expect(o.sentiment).toBeCloseTo(-0.4);
  });

  it("counts a key at most once per day", () => {
    const rows = [
      day("2026-07-01", {
        themes: [
          { key: "work", sentiment: 0.1 },
          { key: "Work", sentiment: 0.3 },
        ],
      }),
    ];
    const [o] = foldMetricsIntoObservations(rows);
    expect(o.occurrences).toBe(1);
    // both sentiments still inform the average
    expect(o.sentiment).toBeCloseTo(0.2);
  });

  it("only counts habits on days they were done", () => {
    const rows = [
      day("2026-07-01", { habits: [{ key: "gym", done: true }] }),
      day("2026-07-02", { habits: [{ key: "gym", done: false }] }),
      day("2026-07-03", { habits: [{ key: "gym", done: true }] }),
    ];
    const [o] = foldMetricsIntoObservations(rows);
    expect(o.kind).toBe("habit");
    expect(o.occurrences).toBe(2);
    expect(o.last_seen).toBe("2026-07-03");
    expect(o.sentiment).toBeNull();
  });

  it("maps strengths and struggles to their observation kinds", () => {
    const rows = [
      day("2026-07-01", {
        strengths_shown: ["held a boundary"],
        struggles_shown: ["ruminating after work"],
      }),
    ];
    const kinds = foldMetricsIntoObservations(rows).map((o) => o.kind);
    expect(kinds).toContain("strength");
    expect(kinds).toContain("struggle");
  });

  it("is idempotent for the same day re-extracted (unique dates in, one count out)", () => {
    // the caller upserts day_metrics by date, so a regenerated entry replaces
    // the row — the fold only ever sees one row per date
    const rows = [day("2026-07-01", { habits: [{ key: "gym", done: true }] })];
    expect(foldMetricsIntoObservations(rows)[0].occurrences).toBe(1);
    expect(foldMetricsIntoObservations(rows)[0].occurrences).toBe(1);
  });

  it("skips malformed raw_json and empty extractions", () => {
    const rows = [
      { date: "2026-07-01", raw_json: "not json at all" },
      { date: "2026-07-02", raw_json: "{}" },
      day("2026-07-03", { themes: [{ key: "ok", sentiment: 0 }] }),
    ];
    expect(foldMetricsIntoObservations(rows)).toHaveLength(1);
  });
});

describe("canonicalKey", () => {
  it("trims and lowercases", () => {
    expect(canonicalKey("  Vendor Conflict ")).toBe("vendor conflict");
  });
});

describe("observationScore", () => {
  const obs = (occurrences: number, last_seen: string) =>
    ({ occurrences, last_seen }) as Pick<Observation, "occurrences" | "last_seen">;

  it("ranks a recent frequent observation above a stale one", () => {
    const fresh = observationScore(obs(5, "2026-07-08"), "2026-07-09");
    const stale = observationScore(obs(5, "2026-05-01"), "2026-07-09");
    expect(fresh).toBeGreaterThan(stale);
  });

  it("more occurrences win at equal recency", () => {
    const often = observationScore(obs(12, "2026-07-08"), "2026-07-09");
    const rare = observationScore(obs(2, "2026-07-08"), "2026-07-09");
    expect(often).toBeGreaterThan(rare);
  });
});
