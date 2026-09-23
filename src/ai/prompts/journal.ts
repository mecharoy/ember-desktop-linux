// Journal-writer prompt. Content moved verbatim from
// src/ai/journal.ts.

import { formatCaptureDaysForPrompt } from "../../captureDays";
import { EMPTY_PROFILE_SUMMARY } from "./counselor";
import type { Capture, Message } from "../../db/types";

export interface JournalPromptInput {
  /** YYYY-MM-DD of the day being written; rendered as "Thursday, 2026-07-09". */
  date?: string;
  captures: Pick<Capture, "created_at" | "text" | "mood_emoji">[];
  transcript: Pick<Message, "role" | "content">[];
  profileSummary?: string;
  /** Their check-in, formatted by ai/checkin.ts. */
  checkIn?: string;
  voice: "first" | "second";
  /** A sample of their own writing from Settings; the entry copies its voice. */
  writingStyle?: string;
  feedbackNote?: string;
  /** The entry being regenerated — without it, feedback like "make it
   * shorter" has no referent. */
  previousEntry?: { title: string; narrative: string; highlights: string[]; counselorNote: string };
}

/** Captures can span several days when earlier ones were never written up,
 *  so each day is labelled — see captureDays.ts. */
function formatCapturesForPrompt(
  captures: JournalPromptInput["captures"],
  date: string | undefined,
): string {
  return formatCaptureDaysForPrompt(captures, date ?? "", "(no captures today)");
}

function formatTranscriptForPrompt(transcript: JournalPromptInput["transcript"]): string {
  if (transcript.length === 0) return "(no conversation today)";
  return transcript.map((m) => `${m.role === "user" ? "User" : "Elytra"}: ${m.content}`).join("\n\n");
}

export const JOURNAL_SYSTEM_PROMPT = `You are Elytra's journal-writing module.
You turn the day's raw captures, their check-in and today's
counselor conversation into a saved journal entry — the record they will
reread months from now, so it should let them relive the day, not just
summarise it.

The captures are usually just today's. When an earlier day was never written
up its notes are still waiting, so they are handed to you here too, labelled
with the day they came from. In that case the entry is a catch-up: it is
dated today and today is its centre of gravity, but account for the older
days honestly rather than dropping them or pretending they were today.

WHAT A COMPLETE ENTRY COVERS
Include each part the material supports, roughly in this order, as flowing
prose in short paragraphs (no headings, no lists inside the narrative):
1. The shape of the day — what happened, in order (morning, afternoon,
   evening), with the concrete details they gave: places, people, what was
   said, what they did. The check-in's lunch, evening break and dinner times
   help place things; a skipped meal is worth a mention only if they made
   something of it.
2. How it felt — the mood arc and where it turned, in their own feeling
   words where they gave any, and their check-in numbers if given ("a 4 out
   of 10 kind of day").
3. The main thread — what mattered most today, and what they realised
   about it while talking.
4. Body and energy — sleep, movement, food, tiredness, when mentioned.
5. People — who was part of the day and how those moments felt.
6. What went well — wins, gratitude, anything worth keeping.
7. Loose ends — what's still open, and what they want from tomorrow.
Skip any part nothing in the material supports. Never pad a part to fill it.

GROUNDING
Ground every sentence in something actually captured, entered in the
check-in, or said in the conversation. Never invent events, feelings, or details that
weren't there. If the conversation was short or thin, write a short, honest
entry rather than manufacturing depth — a tired one-line session deserves a
tired one-line entry, not embellishment.

Output ONLY a JSON object, no markdown code fences, no commentary before or
after it, matching exactly this shape:
{
  "title": string,            // short and specific, a few words — never generic like "A Day" or "Tuesday"
  "narrative": string,        // "The Day" - 200-450 words in the configured voice, short paragraphs
                               // separated by a blank line; shorter when the material is thin
  "highlights": string[],     // 2-5 bullets: the moments that mattered and why
  "counselor_note": string    // ONE specific, evidence-based observation - a pattern, a gentle
                               // challenge, or an acknowledgment. If there is no real insight
                               // today, say something honest and small instead of manufacturing depth.
}`;

function formatDateLine(date: string | undefined): string {
  if (!date) return "";
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return `THE DAY: ${weekday}, ${date}\n\n`;
}

export function buildJournalUserPrompt(input: JournalPromptInput): string {
  const voiceLine =
    input.voice === "first"
      ? 'Write "narrative" in first person (e.g. "I had a rough day...").'
      : 'Write "narrative" in second person (e.g. "You had a rough day...").';

  const previous = input.previousEntry
    ? `\n\nTHE PREVIOUS VERSION OF THIS ENTRY (you are rewriting it — keep what worked):
Title: ${input.previousEntry.title}
Narrative:
${input.previousEntry.narrative}
Highlights:
${input.previousEntry.highlights.length > 0 ? input.previousEntry.highlights.map((h) => `- ${h}`).join("\n") : "(none)"}
Counselor's note: ${input.previousEntry.counselorNote || "(none)"}`
    : "";

  const feedback = input.feedbackNote?.trim()
    ? `\n\nThe user asked for this entry to be regenerated with the following feedback. Obey it visibly: "${input.feedbackNote.trim()}"`
    : "";

  const style = input.writingStyle?.trim()
    ? `\n\nTHEIR WRITING STYLE — a sample of their own writing. Write "narrative" and "highlights" the way they write:
match their sentence length, word choice, punctuation, rhythm and humour, and how plain or vivid they are.
Take only the voice from it, never its events, people or facts. The voice rule above (first or second person) still applies.
<sample>
${input.writingStyle.trim().slice(0, 6000)}
</sample>`
    : "";

  return `${formatDateLine(input.date)}PROFILE (long-term context):
${input.profileSummary ?? EMPTY_PROFILE_SUMMARY}

THEIR CHECK-IN (their own answers before the conversation):
${input.checkIn ?? "(not filled in today)"}

CAPTURES (today's, plus any earlier day that was never written up):
${formatCapturesForPrompt(input.captures, input.date)}

TODAY'S CONVERSATION:
${formatTranscriptForPrompt(input.transcript)}${previous}${style}

${voiceLine}${feedback}

Return the JSON object now.`;
}
