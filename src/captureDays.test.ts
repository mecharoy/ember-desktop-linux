import { describe, expect, it } from "vitest";
import { formatCaptureDaysForPrompt, groupCapturesByDay, labelForDay } from "./captureDays";

const TODAY = "2026-07-09"; // a Thursday

function cap(created_at: string, text: string, mood_emoji: string | null = null) {
  return { id: created_at.length, created_at, text, mood_emoji };
}

describe("labelForDay", () => {
  it("names today and yesterday relatively, everything else absolutely", () => {
    expect(labelForDay(TODAY, TODAY)).toBe("Today");
    expect(labelForDay("2026-07-08", TODAY)).toBe("Yesterday");
    expect(labelForDay("2026-07-06", TODAY)).toBe("Monday, 2026-07-06");
  });

  it("crosses a month boundary correctly", () => {
    expect(labelForDay("2026-06-30", "2026-07-01")).toBe("Yesterday");
  });
});

describe("groupCapturesByDay", () => {
  it("buckets by local day, oldest day and oldest note first", () => {
    const days = groupCapturesByDay(
      [
        cap(`${TODAY}T18:30:00.000+05:30`, "gym anyway"),
        cap("2026-07-07T14:02:00.000+05:30", "argued with vendor"),
        cap(`${TODAY}T09:15:00.000+05:30`, "slept badly"),
        cap("2026-07-07T08:00:00.000+05:30", "early start"),
      ],
      TODAY,
    );
    expect(days.map((d) => d.dateKey)).toEqual(["2026-07-07", TODAY]);
    expect(days[0].captures.map((c) => c.text)).toEqual(["early start", "argued with vendor"]);
    expect(days[1].captures.map((c) => c.text)).toEqual(["slept badly", "gym anyway"]);
    expect(days.map((d) => d.isToday)).toEqual([false, true]);
  });

  it("groups on local wall-clock time, not UTC", () => {
    // 00:30 at +05:30 is still the previous day in UTC. Grouping by UTC would
    // file this note under the wrong day for anyone east of Greenwich.
    const days = groupCapturesByDay([cap(`${TODAY}T00:30:00.000+05:30`, "late night")], TODAY);
    expect(days[0].dateKey).toBe(TODAY);
    expect(days[0].isToday).toBe(true);
  });

  it("returns nothing for no captures", () => {
    expect(groupCapturesByDay([], TODAY)).toEqual([]);
  });
});

describe("formatCaptureDaysForPrompt", () => {
  it("uses a plain list when everything is from today", () => {
    const out = formatCaptureDaysForPrompt(
      [cap(`${TODAY}T18:30:00.000+05:30`, "gym anyway", "💪")],
      TODAY,
    );
    expect(out.trim()).toBe("- 18:30 💪: gym anyway");
    expect(out).not.toContain("Today:");
  });

  it("labels each older day and says why it is still there", () => {
    const out = formatCaptureDaysForPrompt(
      [
        cap(`${TODAY}T18:30:00.000+05:30`, "gym anyway"),
        cap("2026-07-07T14:02:00.000+05:30", "argued with vendor"),
      ],
      TODAY,
    );
    expect(out).toContain("Tuesday, 2026-07-07 — no journal was written that day:");
    expect(out).toContain("- 14:02: argued with vendor");
    expect(out).toContain("Today:");
    // Oldest day first, so the model reads it as a timeline running forward.
    expect(out.indexOf("2026-07-07")).toBeLessThan(out.indexOf("Today:"));
  });

  it("falls back to the caller's empty text", () => {
    expect(formatCaptureDaysForPrompt([], TODAY)).toBe("(none yet today)");
    expect(formatCaptureDaysForPrompt([], TODAY, "(no captures today)")).toBe("(no captures today)");
  });
});
