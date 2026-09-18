// Feedback. Ember has no server, so feedback lands where the
// developer already reads things: the GitHub repository's Issues. The app
// builds a pre-filled "new issue" link and opens it in the browser; the user
// reviews it there and presses Submit themselves. Nothing is sent from the
// app, and nothing from the journal is ever added — only what they typed,
// plus the app version and system if they tick the box. Pure; unit-tested.

import { parseRepo } from "./update";

export type FeedbackKind = "bug" | "idea" | "other";

export const FEEDBACK_KINDS: { id: FeedbackKind; label: string }[] = [
  { id: "idea", label: "An idea" },
  { id: "bug", label: "Something's broken" },
  { id: "other", label: "Something else" },
];

/** GitHub's own limit on a pre-filled URL is about 8 KB; this leaves room
 *  for the encoding and the title. */
export const MAX_FEEDBACK_CHARS = 4000;

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  /** e.g. "Ember 0.3.0 · Windows"; null when they chose not to include it. */
  about: string | null;
}

export function feedbackTitle(input: FeedbackInput): string {
  const firstLine = input.text.trim().split("\n")[0].slice(0, 70).trim();
  const prefix = input.kind === "bug" ? "Bug" : input.kind === "idea" ? "Idea" : "Feedback";
  return firstLine ? `${prefix}: ${firstLine}` : prefix;
}

export function feedbackBody(input: FeedbackInput): string {
  const text = input.text.trim().slice(0, MAX_FEEDBACK_CHARS);
  return [text, input.about ? `\n---\n${input.about}` : ""].join("").trim();
}

/** The pre-filled "new issue" page, or null without a GitHub repository. */
export function feedbackIssueUrl(source: string, input: FeedbackInput): string | null {
  const repo = parseRepo(source);
  if (!repo || !input.text.trim()) return null;
  const labels = input.kind === "bug" ? "bug" : input.kind === "idea" ? "enhancement" : "";
  const params = new URLSearchParams({ title: feedbackTitle(input), body: feedbackBody(input) });
  if (labels) params.set("labels", labels);
  return `https://github.com/${repo.owner}/${repo.repo}/issues/new?${params.toString()}`;
}

/** "Android", "Windows", "macOS" or "Linux", from the webview. */
export function systemName(userAgent: string): string {
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Mac/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "unknown system";
}
