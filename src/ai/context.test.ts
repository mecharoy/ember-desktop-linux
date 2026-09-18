import { describe, expect, it } from "vitest";
import { letterForTonight } from "./context";

const review = { letter: "Dear Amy, a steadier week than it felt.", created_at: "2026-09-06T09:00:00" };

describe("letterForTonight", () => {
  it("hands over a fresh letter they haven't talked about yet", () => {
    expect(letterForTonight(review, "2026-09-04", "2026-09-06")).toBe(review.letter);
    expect(letterForTonight(review, null, "2026-09-08")).toBe(review.letter);
  });

  it("drops it once they've journaled since it was written", () => {
    expect(letterForTonight(review, "2026-09-06", "2026-09-07")).toBe("(none)");
  });

  it("drops a letter more than a week old, and handles no review at all", () => {
    expect(letterForTonight(review, "2026-09-01", "2026-09-14")).toBe("(none)");
    expect(letterForTonight(null, null, "2026-09-07")).toBe("(none)");
  });
});
