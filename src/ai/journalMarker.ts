// The counselor asks the app to write tonight's journal entry by ending its
// reply with a marker on its own line:
//
//   [[write-journal]]
//
// Same approach as reminders.ts: the chat has no tool-calling on any of the
// three providers, so an inline marker the app strips out is the portable
// way for the model to act. Pure — unit-tested.

const JOURNAL_MARKER_RE = /\[\[\s*write-journal\s*\]\]/gi;

/** Strips every write-journal marker and says whether there was one. */
export function extractJournalRequest(reply: string): { clean: string; requested: boolean } {
  let requested = false;
  const stripped = reply.replace(JOURNAL_MARKER_RE, () => {
    requested = true;
    return "";
  });
  if (!requested) return { clean: reply, requested };
  const clean = stripped
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean, requested };
}
