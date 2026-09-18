import { describe, expect, it } from "vitest";
import { planEveningReminders, shouldFireReminder, shouldShowReminderBanner, type ReminderState } from "./scheduler";

function state(overrides: Partial<ReminderState>): ReminderState {
  return {
    now: "2026-07-09T21:35",
    reminderTime: "21:30",
    entrySavedToday: false,
    sessionWrapped: false,
    snoozedUntil: "",
    skipDate: "",
    lastFired: "",
    ...overrides,
  };
}

describe("shouldFireReminder", () => {
  it("fires once the reminder time passes", () => {
    expect(shouldFireReminder(state({}))).toBe(true);
  });

  it("does not fire before the reminder time", () => {
    expect(shouldFireReminder(state({ now: "2026-07-09T18:00" }))).toBe(false);
  });

  it("never fires once the entry is saved or the session wrapped", () => {
    expect(shouldFireReminder(state({ entrySavedToday: true }))).toBe(false);
    expect(shouldFireReminder(state({ sessionWrapped: true }))).toBe(false);
  });

  it("respects skip-tonight for today only", () => {
    expect(shouldFireReminder(state({ skipDate: "2026-07-09" }))).toBe(false);
    expect(shouldFireReminder(state({ skipDate: "2026-07-08" }))).toBe(true);
  });

  it("fires at most once per day without a snooze", () => {
    expect(shouldFireReminder(state({ lastFired: "2026-07-09T21:30" }))).toBe(false);
    expect(shouldFireReminder(state({ lastFired: "2026-07-08T21:30" }))).toBe(true); // yesterday's fire doesn't block
  });

  it("holds during a snooze, then re-fires exactly once after it elapses", () => {
    const snoozing = state({ lastFired: "2026-07-09T21:30", snoozedUntil: "2026-07-09T22:00", now: "2026-07-09T21:45" });
    expect(shouldFireReminder(snoozing)).toBe(false);

    const elapsed = { ...snoozing, now: "2026-07-09T22:01" };
    expect(shouldFireReminder(elapsed)).toBe(true);

    // after the re-fire, lastFired is past snoozedUntil — no third fire
    const refired = { ...elapsed, lastFired: "2026-07-09T22:01", now: "2026-07-09T22:30" };
    expect(shouldFireReminder(refired)).toBe(false);
  });

  it("a snooze set before the first fire just delays it", () => {
    const s = state({ snoozedUntil: "2026-07-09T22:00", now: "2026-07-09T21:45" });
    expect(shouldFireReminder(s)).toBe(false);
    expect(shouldFireReminder({ ...s, now: "2026-07-09T22:00" })).toBe(true);
  });
});

describe("shouldShowReminderBanner", () => {
  it("shows whenever the slot is open, regardless of the one-shot notification", () => {
    expect(shouldShowReminderBanner(state({}))).toBe(true);
    expect(shouldShowReminderBanner(state({ now: "2026-07-09T12:00" }))).toBe(false);
    expect(shouldShowReminderBanner(state({ sessionWrapped: true }))).toBe(false);
    expect(shouldShowReminderBanner(state({ skipDate: "2026-07-09" }))).toBe(false);
    expect(shouldShowReminderBanner(state({ snoozedUntil: "2026-07-09T23:00" }))).toBe(false);
  });
});

describe("planEveningReminders", () => {
  it("rings tonight and the next evenings when tonight is still ahead", () => {
    expect(planEveningReminders(state({ now: "2026-07-09T18:00" }), 3)).toEqual([
      "2026-07-09T21:30",
      "2026-07-10T21:30",
      "2026-07-11T21:30",
    ]);
  });

  it("leaves tonight out once it is done, skipped or already past", () => {
    const later = ["2026-07-10T21:30", "2026-07-11T21:30"];
    expect(planEveningReminders(state({ now: "2026-07-09T18:00", entrySavedToday: true }), 3)).toEqual(later);
    expect(planEveningReminders(state({ now: "2026-07-09T18:00", sessionWrapped: true }), 3)).toEqual(later);
    expect(planEveningReminders(state({ now: "2026-07-09T18:00", skipDate: "2026-07-09" }), 3)).toEqual(later);
    expect(planEveningReminders(state({ now: "2026-07-09T21:35" }), 3)).toEqual(later);
  });

  it("moves tonight's ring to the end of a snooze", () => {
    expect(planEveningReminders(state({ now: "2026-07-09T21:35", snoozedUntil: "2026-07-09T22:05" }), 2)).toEqual([
      "2026-07-09T22:05",
      "2026-07-10T21:30",
    ]);
  });

  it("crosses month ends", () => {
    expect(planEveningReminders(state({ now: "2026-07-31T22:00" }), 2)).toEqual(["2026-08-01T21:30"]);
  });
});