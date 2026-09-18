import { describe, expect, it } from "vitest";
import { extractReminders, hideMarkersWhileStreaming } from "./reminders";

const NOW = "2026-07-11T21:00";

describe("extractReminders", () => {
  it("extracts a valid future reminder and strips the marker", () => {
    const reply =
      "Done — I'll nudge you tomorrow at 10:00.\n[[remind|2026-07-12T10:00|submit the hostel form]]";
    const { clean, reminders } = extractReminders(reply, NOW);
    expect(reminders).toEqual([{ dueAt: "2026-07-12T10:00", text: "submit the hostel form" }]);
    expect(clean).toBe("Done — I'll nudge you tomorrow at 10:00.");
    expect(clean).not.toContain("[[");
  });

  it("handles several markers and dedupes exact repeats", () => {
    const reply =
      "Both set.\n[[remind|2026-07-12T10:00|form]]\n[[remind|2026-07-12T18:30|call Priya]]\n[[remind|2026-07-12T10:00|form]]";
    const { reminders } = extractReminders(reply, NOW);
    expect(reminders).toHaveLength(2);
  });

  it("strips but does not schedule malformed, impossible, past, or empty markers", () => {
    const reply = [
      "Okay.",
      "[[remind|tomorrow at 10|form]]", // not ISO
      "[[remind|2026-02-31T10:00|form]]", // impossible date
      "[[remind|2026-07-10T10:00|form]]", // in the past
      "[[remind|2026-07-12T10:00|   ]]", // empty text
    ].join("\n");
    const { clean, reminders } = extractReminders(reply, NOW);
    expect(reminders).toEqual([]);
    expect(clean).toBe("Okay.");
  });

  it("leaves replies without markers untouched", () => {
    const { clean, reminders } = extractReminders("What made it a 4 and not a 3?", NOW);
    expect(reminders).toEqual([]);
    expect(clean).toBe("What made it a 4 and not a 3?");
  });

  it("collapses the blank lines a stripped marker leaves behind", () => {
    const reply = "First part.\n\n[[remind|2026-07-12T10:00|form]]\n\nSecond part.";
    const { clean } = extractReminders(reply, NOW);
    expect(clean).toBe("First part.\n\nSecond part.");
  });
});

describe("hideMarkersWhileStreaming", () => {
  it("hides a complete marker mid-stream", () => {
    expect(hideMarkersWhileStreaming("Sure.\n[[remind|2026-07-12T10:00|form]]")).toBe("Sure.");
  });

  it("hides a partially arrived marker", () => {
    expect(hideMarkersWhileStreaming("Sure.\n[[remind|2026-07-1")).toBe("Sure.");
  });

  it("passes ordinary text through", () => {
    expect(hideMarkersWhileStreaming("Sure thing.")).toBe("Sure thing.");
  });
});
