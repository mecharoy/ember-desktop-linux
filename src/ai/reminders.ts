// Reminder markers in counselor replies. The chat works on all three
// providers with no tool-calling, so the model sets reminders by appending
// an inline marker the app parses out of the finished reply:
//
//   [[remind|2026-07-13T10:00|submit the hostel form]]
//
// Each candidate is zod-validated; malformed or past-dated markers are
// silently stripped rather than retried — a streamed chat turn can't be
// re-run without disrupting the conversation, and the reply itself must
// never be lost or blocked.
// Pure functions, unit tested in reminders.test.ts.

import { z } from "zod";

export interface ExtractedReminder {
  dueAt: string; // "YYYY-MM-DDTHH:MM" local
  text: string;
}

const MARKER_RE = /\[\[\s*remind\s*\|([^|\]]*)\|([^\]]*)\]\]/g;

/** Rejects shapes that match the pattern but aren't real dates (2026-02-31). */
function isRealDateTime(s: string): boolean {
  const d = new Date(`${s}:00`);
  if (Number.isNaN(d.getTime())) return false;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}` ===
    s
  );
}

const reminderSchema = z.object({
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .refine(isRealDateTime),
  text: z.string().trim().min(1).max(200),
});

/**
 * Strips every reminder marker from the reply (valid or not — marker syntax
 * must never reach the user or the stored transcript) and returns the valid,
 * future-dated ones. `now` is "YYYY-MM-DDTHH:MM" local.
 */
export function extractReminders(
  reply: string,
  now: string,
): { clean: string; reminders: ExtractedReminder[] } {
  const reminders: ExtractedReminder[] = [];
  const seen = new Set<string>();

  const stripped = reply.replace(MARKER_RE, (_match, due: string, text: string) => {
    const parsed = reminderSchema.safeParse({ dueAt: due.trim(), text: text.trim() });
    if (parsed.success && parsed.data.dueAt > now) {
      const key = `${parsed.data.dueAt}|${parsed.data.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        reminders.push(parsed.data);
      }
    }
    return "";
  });

  const clean = stripped
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { clean, reminders };
}

/** Display filter for the streaming bubble: hides every complete marker
 * (reminders and [[write-journal]] alike) and a trailing half-arrived one,
 * so the user never watches marker syntax type itself out. */
export function hideMarkersWhileStreaming(text: string): string {
  return text
    .replace(MARKER_RE, "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[[^\]]*$/, "")
    .trimEnd();
}
