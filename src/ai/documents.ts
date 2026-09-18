// Pure helpers for the user's reference documents (.md/.txt added in
// Settings). No db imports — unit-tested directly; context.ts does the fetch.
//
// Every enabled document rides in the counselor system prompt, which is built
// once per session and then cached (see prompts/counselor.ts). So a document
// is paid for in full on the first turn and cheaply after that. The budget
// keeps that first turn bounded, and keeps small local models from silently
// dropping the start of an oversized prompt.

import type { UserDocument } from "../db/types";

/** Total characters of document text loaded into one session (~10k tokens). */
export const DOCUMENT_CHAR_BUDGET = 40_000;

/** Largest single file accepted when adding one. */
export const DOCUMENT_MAX_FILE_BYTES = 200_000;

/** What the file picker offers. */
// text/* and octet-stream too: Android often files .md under no text type,
// and its picker would otherwise grey them out. The name check below still
// turns away anything that isn't .md or .txt.
export const DOCUMENT_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain,text/*,application/octet-stream";

export function isAcceptedDocumentName(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

/** BOM off, Windows/old-Mac line endings to \n, no trailing blank space. */
export function normalizeDocumentText(raw: string): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return text.replace(/\r\n?/g, "\n").trimEnd();
}

/**
 * Each document as a named block, in the order given. Once the budget runs
 * out, the document that crosses it is cut short and any after it are only
 * named — so the model can say honestly that it hasn't seen them.
 */
export function formatDocumentsForPrompt(
  docs: Pick<UserDocument, "name" | "content">[],
  budget: number = DOCUMENT_CHAR_BUDGET,
): string {
  if (docs.length === 0) return "(none)";

  let left = budget;
  const blocks: string[] = [];
  const skipped: string[] = [];
  for (const d of docs) {
    if (left <= 0) {
      skipped.push(d.name);
      continue;
    }
    const cut = d.content.length > left;
    const body = cut
      ? `${d.content.slice(0, left)}\n[…the rest of this document was cut to fit]`
      : d.content || "(empty)";
    left -= Math.min(d.content.length, left);
    blocks.push(`--- ${d.name} ---\n${body}\n--- end of ${d.name} ---`);
  }
  if (skipped.length > 0) {
    blocks.push(`(not loaded — over the space limit: ${skipped.join(", ")})`);
  }
  return blocks.join("\n\n");
}
