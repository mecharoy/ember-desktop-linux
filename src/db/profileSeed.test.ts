import { describe, expect, it } from "vitest";
import { composeSeedProfile } from "./profileSeed";

describe("composeSeedProfile", () => {
  it("returns null when every answer is empty or whitespace", () => {
    expect(composeSeedProfile("Abhi", [], "2026-07-11")).toBeNull();
    expect(
      composeSeedProfile(
        "Abhi",
        [
          { label: "A typical day", text: "" },
          { label: "People who matter", text: "   " },
        ],
        "2026-07-11",
      ),
    ).toBeNull();
  });

  it("includes only answered questions, trimmed, with name and date", () => {
    const out = composeSeedProfile(
      "  Abhi ",
      [
        { label: "A typical day", text: "  lab, gym, dinner with flatmates  " },
        { label: "People who matter", text: "" },
        { label: "Currently weighing on them", text: "PhD funding" },
      ],
      "2026-07-11",
    );
    expect(out).toBe(
      "Abhi's first-setup self-portrait, in their own words (2026-07-11):\n" +
        "- A typical day: lab, gym, dinner with flatmates\n" +
        "- Currently weighing on them: PhD funding",
    );
  });

  it("falls back to 'The user' when no name was given", () => {
    const out = composeSeedProfile("", [{ label: "On hard days", text: "long walks" }], "2026-07-11");
    expect(out).toMatch(/^The user's first-setup self-portrait/);
  });
});
