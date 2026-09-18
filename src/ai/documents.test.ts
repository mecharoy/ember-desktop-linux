import { describe, expect, it } from "vitest";
import {
  formatDocumentsForPrompt,
  isAcceptedDocumentName,
  normalizeDocumentText,
} from "./documents";

describe("isAcceptedDocumentName", () => {
  it("takes markdown and text files, any case", () => {
    for (const name of ["about-me.md", "Goals.TXT", "notes.markdown"]) {
      expect(isAcceptedDocumentName(name)).toBe(true);
    }
  });

  it("rejects everything else, including look-alikes", () => {
    for (const name of ["cv.pdf", "photo.png", "md", "notes.md.exe", "readme"]) {
      expect(isAcceptedDocumentName(name)).toBe(false);
    }
  });
});

describe("normalizeDocumentText", () => {
  it("strips a BOM, unifies line endings and trims the tail", () => {
    const raw = String.fromCharCode(0xfeff) + "line one\r\nline two\rline three\n\n  ";
    expect(normalizeDocumentText(raw)).toBe(["line one", "line two", "line three"].join("\n"));
  });
});

describe("formatDocumentsForPrompt", () => {
  it("says (none) when there are no documents", () => {
    expect(formatDocumentsForPrompt([])).toBe("(none)");
  });

  it("wraps each document in named start/end markers, in order", () => {
    const out = formatDocumentsForPrompt([
      { name: "about-me.md", content: "PhD student." },
      { name: "goals.txt", content: "Finish chapter 3." },
    ]);
    expect(out).toBe(
      [
        "--- about-me.md ---",
        "PhD student.",
        "--- end of about-me.md ---",
        "",
        "--- goals.txt ---",
        "Finish chapter 3.",
        "--- end of goals.txt ---",
      ].join("\n"),
    );
  });

  it("marks an empty file instead of leaving a blank block", () => {
    expect(formatDocumentsForPrompt([{ name: "blank.md", content: "" }])).toContain("(empty)");
  });

  it("cuts the document that crosses the budget and names the ones after it", () => {
    const out = formatDocumentsForPrompt(
      [
        { name: "a.md", content: "aaaaaa" },
        { name: "b.md", content: "bbbbbb" },
        { name: "c.md", content: "cccccc" },
      ],
      10,
    );
    expect(out).toContain("aaaaaa");
    expect(out).toContain("bbbb\n[…the rest of this document was cut to fit]");
    expect(out).not.toContain("bbbbb");
    expect(out).not.toContain("cccc");
    expect(out).toContain("(not loaded — over the space limit: c.md)");
  });
});
