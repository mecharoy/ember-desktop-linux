import { describe, expect, it } from "vitest";
import { extractJournalRequest } from "./journalMarker";
import { hideMarkersWhileStreaming } from "./reminders";

describe("extractJournalRequest", () => {
  it("strips the marker and reports the request", () => {
    const reply = ["Lovely — writing it now.", "", "[[write-journal]]"].join("\n");
    expect(extractJournalRequest(reply)).toEqual({ clean: "Lovely — writing it now.", requested: true });
  });

  it("tolerates spacing and case", () => {
    expect(extractJournalRequest("Done. [[ Write-Journal ]]").requested).toBe(true);
  });

  it("leaves an ordinary reply untouched", () => {
    const reply = "What made it a 4 and not a 3?  ";
    expect(extractJournalRequest(reply)).toEqual({ clean: reply, requested: false });
  });
});

describe("hideMarkersWhileStreaming", () => {
  it("hides a complete write-journal marker and a half-arrived one", () => {
    expect(hideMarkersWhileStreaming("Writing it now.\n[[write-journal]]")).toBe("Writing it now.");
    expect(hideMarkersWhileStreaming("Writing it now.\n[[write-jou")).toBe("Writing it now.");
  });
});
