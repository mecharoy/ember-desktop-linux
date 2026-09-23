// Extractor prompt. Runs after an entry is saved and turns
// the entry + transcript (+ the user's check-in) into strict JSON that fuels
// day_metrics, observations, and every Insights module.

import type { Message } from "../../db/types";

export interface ExtractorPromptInput {
  date: string; // YYYY-MM-DD, the day being extracted
  entry: { title: string; narrative: string; highlights: string[]; counselorNote: string };
  transcript: Pick<Message, "role" | "content">[];
  /** Names already in use, so the same concept keeps the same key every day. */
  knownNames?: { themes: string[]; habits: string[]; people: string[]; activities?: string[] };
  /** Habits the user dismissed as "not a habit" — never recorded. */
  dismissedHabits?: string[];
  /** Their own check-in answers for the day, already formatted (ai/checkin.ts). */
  checkIn?: string;
}

export const EXTRACTOR_SYSTEM_PROMPT = `You are Elytra's extraction module.
Given a saved journal entry, the evening conversation it came from and — when
they filled it in — the user's own check-in, you distill the day into
structured data. You never invent: every value must be grounded in something
actually written, said or entered. When something is unclear or simply
wasn't mentioned, use null (for numbers) or leave the list empty — never guess.
The one exception is mood, below.

Output ONLY a JSON object — no markdown code fences, no commentary before or
after it — matching exactly this shape:
{
  "mood": 6,                      // integer 1-10 for the day overall. If the CHECK-IN gives a mood, copy
                                  // it exactly. Otherwise ESTIMATE it from how they describe the day
                                  // in their own words (1 = awful, 5 = middling, 10 = wonderful):
                                  // "really well, so relieved" is about 8, "exhausted and on edge" about
                                  // 3, "fine" about 5-6. Weigh the day as a whole, not its last line.
                                  // null only when they said nothing about how the day felt.
  "energy": 4,                    // integer 1-10, or null. If the CHECK-IN gives energy, copy it.
  "summary_line": "Draining vendor conflict, redeemed by a strong gym session.",
                                  // ONE sentence capturing the day, used in chart tooltips
  "themes": [{"key": "vendor conflict", "sentiment": -0.6}],
                                  // topics occupying their mind today, at most 6; sentiment -1..1
  "habits": [{"key": "gym", "done": true}],
                                  // concrete, repeatable behaviors (gym, meditation, doomscrolling,
                                  // skipped lunch...). done=true: they did it today. done=false: they
                                  // say they skipped or missed it. Not mentioned: leave it out.
                                  // One-off events are not habits.
  "people": [{"key": "Priya", "sentiment": 0.3}],
                                  // people who actually appeared today; sentiment -1..1 of the interaction
  "emotions": ["frustrated", "proud"],
                                  // feelings present in the day as lowercase adjectives — may be your
                                  // reading of what they described
  "emotions_named": ["drained"],
                                  // ONLY feeling words the user typed themselves (in their messages or
                                  // check-in), lowercase, as they wrote them. Empty if they named none.
  "sleep_hours": 6.5,             // hours slept LAST NIGHT (the night before this day); null unless
                                  // stated. If the CHECK-IN gives sleep, copy it.
  "strengths_shown": ["held boundary in a hard conversation"],
                                  // short phrases; empty array if none clearly shown
  "struggles_shown": ["ruminating after work hours"],
                                  // short phrases; empty array if none clearly shown
  "activities": [{"key": "walk", "pleasure": 3, "mastery": 1}],
                                  // things they did today that took some part of the day (not every
                                  // errand), at most 8, short canonical keys. pleasure = how much
                                  // they enjoyed it, mastery = the sense of achievement it gave, each
                                  // 0 (none) to 3 (a lot), ONLY as their own words show it — null
                                  // when they didn't say how it felt.
  "thinking_traps": [{"type": "catastrophising", "quote": "this is going to ruin everything"}],
                                  // thinking traps from cognitive behavioural therapy, ONLY in the
                                  // USER's own messages — never Elytra's lines or the entry. "quote"
                                  // is their exact words copied character for character, at most 25
                                  // words. Most days have none: record one only when it is plainly
                                  // there. "type" is one of:
                                  //   all_or_nothing (total success or total failure),
                                  //   overgeneralising (one event becomes "always"/"never"),
                                  //   mental_filter (one bad detail colours everything),
                                  //   discounting_positives (good things waved away),
                                  //   mind_reading (sure what others think, unsaid),
                                  //   fortune_telling (predicting it will go badly),
                                  //   catastrophising (jumping to the worst outcome),
                                  //   emotional_reasoning ("I feel it, so it's true"),
                                  //   should_statements (harsh musts and shoulds),
                                  //   labelling (calling themselves a name),
                                  //   personalising (blaming themselves for what wasn't theirs)
  "rhythm": {"first_contact": "08:30", "work_start": "09:15", "dinner": "20:00"}
                                  // 24-hour "HH:MM" times of today's first contact with another
                                  // person (in person, call or message), when work or study started,
                                  // and dinner — only when stated or clearly implied ("had dinner
                                  // around 8" → "20:00"); null otherwise
}

NAMING — this is what makes counting across days work:
- Keys are short canonical names — "gym", not "went to the gym again today".
- KNOWN NAMES lists the names already in use. When today's item is the same
  concept, reuse that exact name ("a workout" today → "gym" if gym is known).
  Create a new name only for something genuinely new.
- People: the name they use; family by relation ("mom"), the same way every time.
- Never record anything listed under NOT HABITS as a habit.`;

function nameList(names: string[] | undefined): string {
  return names && names.length > 0 ? names.join(", ") : "(none yet)";
}

export function buildExtractorUserPrompt(input: ExtractorPromptInput): string {
  const transcript =
    input.transcript.length === 0
      ? "(no conversation — the entry was written from captures alone)"
      : input.transcript.map((m) => `${m.role === "user" ? "User" : "Elytra"}: ${m.content}`).join("\n\n");

  return `DATE: ${input.date}

THEIR CHECK-IN (their own answers — copy mood, energy and sleep from here):
${input.checkIn ?? "(not filled in today)"}

KNOWN NAMES (reuse when it is the same concept):
- themes: ${nameList(input.knownNames?.themes)}
- habits: ${nameList(input.knownNames?.habits)}
- people: ${nameList(input.knownNames?.people)}
- activities: ${nameList(input.knownNames?.activities)}

NOT HABITS (the user dismissed these): ${nameList(input.dismissedHabits)}

SAVED JOURNAL ENTRY
Title: ${input.entry.title}
Narrative:
${input.entry.narrative}

Highlights:
${input.entry.highlights.length > 0 ? input.entry.highlights.map((h) => `- ${h}`).join("\n") : "(none)"}

Counselor's note: ${input.entry.counselorNote || "(none)"}

THE CONVERSATION IT CAME FROM
${transcript}

Return the JSON object now.`;
}
