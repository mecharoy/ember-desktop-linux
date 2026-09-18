import { describe, expect, it } from "vitest";
import { feelingWords, formatCheckInForPrompt, formatDayParts, sleepHoursFrom, toCheckInSummary } from "./checkin";
import type { CheckIn } from "../db/types";

const row: CheckIn = {
  date: "2026-09-10",
  mood: 4,
  energy: 3,
  sleep_hours: 6.5,
  feeling: " drained, a bit anxious ",
  on_mind: "the exam on Friday",
  habits: JSON.stringify({ gym: false, studying: true }),
  created_at: "2026-09-10T21:00:00",
  updated_at: "2026-09-10T21:00:00",
  bedtime: null,
  wake_time: null,
  sleep_latency_min: null,
  sleep_quality: null,
  lunch: null,
  evening_break: null,
  dinner: null,
  day_notes: null,
};

function blankRow(): CheckIn {
  return {
    ...row,
    mood: null,
    energy: null,
    sleep_hours: null,
    feeling: null,
    on_mind: null,
    habits: "{}",
  };
}

describe("sleepHoursFrom", () => {
  it("counts across midnight and takes off the time to fall asleep", () => {
    expect(sleepHoursFrom("23:30", "07:00", 30)).toBe(7);
    expect(sleepHoursFrom("01:00", "08:15", null)).toBe(7.5);
    expect(sleepHoursFrom("23:00", null, 10)).toBeNull();
  });
});

describe("toCheckInSummary", () => {
  it("reads a filled-in row", () => {
    expect(toCheckInSummary(row)).toEqual({
      mood: 4,
      energy: 3,
      sleepHours: 6.5,
      feeling: "drained, a bit anxious",
      onMind: "the exam on Friday",
      habits: { gym: false, studying: true },
      bedtime: null,
      wakeTime: null,
      sleepLatencyMin: null,
      sleepQuality: null,
      lunch: null,
      eveningBreak: null,
      dinner: null,
      dayNotes: {},
    });
  });

  it("reads what they did in each stretch and keeps a row with only that", () => {
    const s = toCheckInSummary({ ...blankRow(), day_notes: JSON.stringify({ morning: " lab work ", night: "", bogus: "x" }) });
    expect(s?.dayNotes).toEqual({ morning: "lab work" });
    expect(formatCheckInForPrompt(s)).toContain('- what they did, waking up → lunch, in their words: "lab work"');
  });

  it("reads lunch, evening break and dinner, and ignores anything else stored there", () => {
    const s = toCheckInSummary({ ...row, lunch: "13:05", evening_break: "skipped", dinner: "not-yet" });
    expect([s?.lunch, s?.eveningBreak, s?.dinner]).toEqual(["13:05", "skipped", "not-yet"]);
    expect(toCheckInSummary({ ...row, lunch: "around one" })?.lunch).toBeNull();
  });

  it("counts meal times alone as a check-in", () => {
    const blank = { ...row, mood: null, energy: null, sleep_hours: null, feeling: null, on_mind: null, habits: "{}" };
    expect(toCheckInSummary({ ...blank, dinner: "skipped" })?.dinner).toBe("skipped");
  });

  it("counts a sleep diary alone as a check-in", () => {
    const blank = { ...row, mood: null, energy: null, sleep_hours: null, feeling: null, on_mind: null, habits: "{}" };
    expect(toCheckInSummary({ ...blank, bedtime: "23:30" })?.bedtime).toBe("23:30");
  });

  it("treats a row with nothing filled in as no check-in", () => {
    const blank = { ...row, mood: null, energy: null, sleep_hours: null, feeling: "  ", on_mind: null, habits: "{}" };
    expect(toCheckInSummary(blank)).toBeNull();
    expect(toCheckInSummary(null)).toBeNull();
  });

  it("survives unreadable habits JSON and drops non-boolean values", () => {
    expect(toCheckInSummary({ ...row, habits: "nope" })?.habits).toEqual({});
    expect(toCheckInSummary({ ...row, habits: '{"gym":"yes","run":true}' })?.habits).toEqual({ run: true });
  });
});

describe("formatCheckInForPrompt", () => {
  it("lists only what was filled in, quoting their own words", () => {
    const text = formatCheckInForPrompt(toCheckInSummary(row));
    expect(text).toBe(
      [
        "- mood: 4/10",
        "- energy: 3/10",
        "- slept last night: 6.5h",
        '- feeling, in their words: "drained, a bit anxious"',
        '- on their mind: "the exam on Friday"',
        "- habits today: gym not done, studying done",
      ].join("\n"),
    );
    expect(formatCheckInForPrompt(null)).toBe("(not filled in today)");
  });

  it("adds the sleep diary when it was filled in", () => {
    const text = formatCheckInForPrompt(
      toCheckInSummary({ ...row, bedtime: "23:40", wake_time: "07:10", sleep_latency_min: 30, sleep_quality: 2 }),
    );
    expect(text).toContain("- in bed 23:40, up 07:10");
    expect(text).toContain("- took 30 min to fall asleep");
    expect(text).toContain("- sleep quality: 2/5");
  });

  it("adds the day's meal points", () => {
    const text = formatCheckInForPrompt(toCheckInSummary({ ...row, lunch: "skipped", evening_break: "18:30", dinner: "not-yet" }));
    expect(text).toContain("- lunch: skipped\n- evening break: 18:30\n- dinner: not yet");
  });
});

describe("formatDayParts", () => {
  const withTimes = (over: Partial<CheckIn>) => toCheckInSummary({ ...row, wake_time: "07:10", ...over });

  it("splits a full day into four parts", () => {
    expect(formatDayParts(withTimes({ lunch: "13:00", evening_break: "18:30", dinner: "20:45" }))).toBe(
      [
        "1. waking up (07:10) → lunch (13:00)",
        "2. lunch (13:00) → evening break (18:30)",
        "3. evening break (18:30) → dinner (20:45)",
        "4. dinner (20:45) → now",
      ].join("\n"),
    );
  });

  it("merges the parts around a skipped meal", () => {
    expect(formatDayParts(withTimes({ lunch: "skipped", evening_break: "18:30", dinner: "20:45" }))).toBe(
      [
        "1. waking up (07:10) → evening break (18:30) — no lunch today",
        "2. evening break (18:30) → dinner (20:45)",
        "3. dinner (20:45) → now",
      ].join("\n"),
    );
    expect(formatDayParts(withTimes({ lunch: "13:00", evening_break: "18:30", dinner: "skipped" }))).toBe(
      [
        "1. waking up (07:10) → lunch (13:00)",
        "2. lunch (13:00) → evening break (18:30)",
        "3. evening break (18:30) → now — no dinner today",
      ].join("\n"),
    );
  });

  it("ends the day at now when a point hasn't happened yet", () => {
    expect(formatDayParts(withTimes({ lunch: "13:00", evening_break: "18:30", dinner: "not-yet" }))).toBe(
      ["1. waking up (07:10) → lunch (13:00)", "2. lunch (13:00) → evening break (18:30)", "3. evening break (18:30) → now — dinner not yet"].join(
        "\n",
      ),
    );
    expect(formatDayParts(withTimes({ lunch: "skipped", evening_break: "not-yet" }))).toBe(
      "1. waking up (07:10) → now — no lunch today, evening break not yet",
    );
  });

  it("still splits the day without a check-in, and says when an earlier day ends", () => {
    expect(formatDayParts(null, { lookingBack: true })).toBe(
      [
        "1. waking up → lunch (time not given)",
        "2. lunch (time not given) → evening break (time not given)",
        "3. evening break (time not given) → dinner (time not given)",
        "4. dinner (time not given) → the end of the day",
      ].join("\n"),
    );
  });
});

describe("feelingWords", () => {
  it("splits a feeling answer into short feeling words", () => {
    expect(feelingWords("Tired, a bit anxious and hopeful.")).toEqual(["tired", "a bit anxious", "hopeful"]);
    expect(feelingWords("I don't really know what I am feeling")).toEqual([]);
    expect(feelingWords(null)).toEqual([]);
  });
});
