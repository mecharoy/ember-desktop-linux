import { describe, expect, it } from "vitest";
import { feedbackBody, feedbackIssueUrl, feedbackTitle, MAX_FEEDBACK_CHARS, systemName } from "./feedback";

describe("feedback", () => {
  const input = { kind: "idea" as const, text: "Let me export a single month\nas a PDF, please.", about: "Elytra 0.3.0 · Windows" };

  it("titles the issue from the first line", () => {
    expect(feedbackTitle(input)).toBe("Idea: Let me export a single month");
    expect(feedbackTitle({ ...input, kind: "bug", text: "" })).toBe("Bug");
  });

  it("adds version and system only when they chose to include them", () => {
    expect(feedbackBody(input)).toBe("Let me export a single month\nas a PDF, please.\n---\nElytra 0.3.0 · Windows");
    expect(feedbackBody({ ...input, about: null })).toBe("Let me export a single month\nas a PDF, please.");
  });

  it("builds a pre-filled GitHub issue link, with a label by kind", () => {
    const url = new URL(feedbackIssueUrl("https://github.com/owner/ember", input)!);
    expect(url.origin + url.pathname).toBe("https://github.com/owner/ember/issues/new");
    expect(url.searchParams.get("title")).toBe("Idea: Let me export a single month");
    expect(url.searchParams.get("labels")).toBe("enhancement");
    expect(url.searchParams.get("body")).toContain("as a PDF, please.");
  });

  it("needs a repository and some text", () => {
    expect(feedbackIssueUrl("", input)).toBeNull();
    expect(feedbackIssueUrl("https://github.com/owner/ember", { ...input, text: "   " })).toBeNull();
  });

  it("caps very long feedback so the link still opens", () => {
    const long = { ...input, text: "x".repeat(MAX_FEEDBACK_CHARS + 500), about: null };
    expect(feedbackBody(long)).toHaveLength(MAX_FEEDBACK_CHARS);
  });

  it("names the system", () => {
    expect(systemName("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows");
    expect(systemName("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("macOS");
  });
});
