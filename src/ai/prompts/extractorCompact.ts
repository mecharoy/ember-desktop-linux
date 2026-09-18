// The extractor for small models (compact mode): the one long job of
// prompts/extractor.ts split in two short ones, each with a few fields and a
// one-line rule per field. Small models fill a short JSON shape far more
// reliably than a long one. Both parts read the same material; ai/extractor.ts
// merges their answers into the usual extraction. Thinking traps are left to
// big models: tested on a 4B model, the quotes were real but the labels were
// often wrong, and a wrong label misleads the Thinking patterns section.

import type { ExtractorPromptInput } from "./extractor";

const COMMON = `Never invent: every value must come from what is written below. When
something wasn't mentioned, use null or an empty list. Output ONLY a JSON
object, no code fences, no comments.`;

export const EXTRACT_DAY_SYSTEM_PROMPT = `You read one day from someone's journal and write down facts about the day.
${COMMON}

{
  "mood": 1-10 or null,        // copy the check-in's mood if given; otherwise judge from their own words (1 awful, 5 middling, 10 wonderful)
  "energy": 1-10 or null,      // copy the check-in's energy if given
  "summary_line": "...",       // one sentence about the day
  "themes": [{"key": "...", "sentiment": -1 to 1}],   // what was on their mind, at most 5, short names
  "habits": [{"key": "...", "done": true}],           // repeatable behaviours only (gym, doomscrolling); done=false if they said they skipped it
  "people": [{"key": "...", "sentiment": -1 to 1}],   // people who were part of the day
  "sleep_hours": number or null,                      // last night; copy from the check-in if given
  "rhythm": {"first_contact": "HH:MM" or null, "work_start": "HH:MM" or null, "dinner": "HH:MM" or null}
}

Names: reuse a name from KNOWN NAMES when it is the same thing. Never record
anything under NOT HABITS as a habit.`;

export const EXTRACT_PERSON_SYSTEM_PROMPT = `You read one day from someone's journal and note how they were.
${COMMON}

{
  "emotions": ["..."],          // feelings in the day, lowercase adjectives
  "emotions_named": ["..."],    // ONLY feeling words THEY typed themselves, as written
  "strengths_shown": ["..."],   // short phrases, only if clearly shown
  "struggles_shown": ["..."],   // short phrases, only if clearly shown
  "activities": [{"key": "...", "pleasure": 0-3 or null, "mastery": 0-3 or null}]
                                // things that took part of the day, at most 6; pleasure = enjoyment,
                                // mastery = sense of achievement, only as their words show, else null
}

"emotions_named" holds single feeling words (1-3 words each, e.g. "tense"),
never a whole phrase or sentence.`;

function names(list: string[] | undefined): string {
  return list && list.length > 0 ? list.slice(0, 15).join(", ") : "(none yet)";
}

/** Shared material for both parts. Only their own messages are included:
 *  Ember's side is in the entry already, and it isn't theirs to quote. */
export function buildExtractCompactPrompt(input: ExtractorPromptInput, theirWords: string): string {
  return `DATE: ${input.date}

THEIR CHECK-IN:
${input.checkIn ?? "(not filled in)"}

KNOWN NAMES:
- themes: ${names(input.knownNames?.themes)}
- habits: ${names(input.knownNames?.habits)}
- people: ${names(input.knownNames?.people)}
- activities: ${names(input.knownNames?.activities)}

NOT HABITS: ${names(input.dismissedHabits)}

THE JOURNAL ENTRY
${input.entry.title}
${input.entry.narrative}
${input.entry.highlights.map((h) => `- ${h}`).join("\n")}

WHAT THEY SAID IN THE CONVERSATION
${theirWords || "(no conversation)"}

Return the JSON now.`;
}
