import { describe, expect, it } from "vitest";
import { entryToExtractorInput } from "./extractor";

const entry = {
  date: "2026-07-09",
  title: "Vendor day",
  narrative: "A bruising afternoon, redeemed by the gym.",
  highlights: JSON.stringify(["Held your ground", "Gym anyway"]),
  counselor_note: "Third clash this month.",
};

describe("entryToExtractorInput", () => {
  it("rebuilds the extractor input from a stored entry and its messages", () => {
    const input = entryToExtractorInput(entry, [
      { role: "user", content: "rough afternoon" },
      { role: "assistant", content: "What made it rough?" },
    ]);
    expect(input).toEqual({
      date: "2026-07-09",
      entry: {
        title: "Vendor day",
        narrative: "A bruising afternoon, redeemed by the gym.",
        highlights: ["Held your ground", "Gym anyway"],
        counselorNote: "Third clash this month.",
      },
      transcript: [
        { role: "user", content: "rough afternoon" },
        { role: "assistant", content: "What made it rough?" },
      ],
    });
  });

  it("treats unreadable or non-list highlights as none, and keeps only strings", () => {
    expect(entryToExtractorInput({ ...entry, highlights: "not json" }, []).entry.highlights).toEqual([]);
    expect(entryToExtractorInput({ ...entry, highlights: '{"a":1}' }, []).entry.highlights).toEqual([]);
    expect(entryToExtractorInput({ ...entry, highlights: "" }, []).entry.highlights).toEqual([]);
    expect(entryToExtractorInput({ ...entry, highlights: '["ok", 3, null]' }, []).entry.highlights).toEqual(["ok"]);
  });

  it("works for an entry written without a conversation", () => {
    expect(entryToExtractorInput(entry, []).transcript).toEqual([]);
  });
});
