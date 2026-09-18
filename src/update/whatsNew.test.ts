import { describe, expect, it } from "vitest";
import { BUG_FIXES_ONLY, decideWhatsNew, notesFor, RELEASE_NOTES } from "./whatsNew";

describe("notesFor", () => {
  it("lists the highlights of a release that has them", () => {
    const version = Object.keys(RELEASE_NOTES)[0];
    expect(notesFor(version)).toBe(RELEASE_NOTES[version]);
  });

  it("says bug fixes for a release without any", () => {
    expect(notesFor("99.0.1")).toBe(BUG_FIXES_ONLY);
  });
});

describe("decideWhatsNew", () => {
  it("stays quiet on a brand new install, but remembers the version", () => {
    expect(decideWhatsNew({ seen: "", current: "0.5.0", fresh: true })).toBe("remember");
  });

  it("shows it to someone updating from before versions were tracked", () => {
    expect(decideWhatsNew({ seen: "", current: "0.5.0", fresh: false })).toBe("show");
  });

  it("shows it after an update", () => {
    expect(decideWhatsNew({ seen: "0.5.0", current: "0.5.1", fresh: false })).toBe("show");
  });

  it("does nothing when the version is the one already seen", () => {
    expect(decideWhatsNew({ seen: "0.5.0", current: "0.5.0", fresh: false })).toBe("none");
  });

  it("does not show anything after a rollback", () => {
    expect(decideWhatsNew({ seen: "0.5.0", current: "0.1.0", fresh: false })).toBe("remember");
  });

  it("ignores an unknown current version", () => {
    expect(decideWhatsNew({ seen: "1.0.0", current: "", fresh: false })).toBe("none");
  });
});
