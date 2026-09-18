// Writes every prompt Ember sends, filled in with sample data, to
// ../prompt-review/PROMPTS.md for reading. Skipped in normal test runs; to
// regenerate after changing a prompt:
//
//   EMBER_PROMPT_REVIEW=1 npx vitest run src/ai/prompts/promptReview.test.ts

import { it } from "vitest";
import { counselorSystemPrompt, counselorTurnPreamble, type CounselorPromptLayers } from "./counselor";
import { counselorCompactPrompt, type CompactPromptLayers } from "./counselorCompact";
import { APPROACHES, TONES } from "./style";
import { AGENDA_SYSTEM_PROMPT, formatAgendaForPreamble } from "../agenda";
import { prepSystemPrompt } from "../prepare";
import { CHAT_SUMMARY_SYSTEM_PROMPT } from "../window";
import { JOURNAL_SYSTEM_PROMPT, buildJournalUserPrompt } from "./journal";
import { EXTRACTOR_SYSTEM_PROMPT, buildExtractorUserPrompt } from "./extractor";
import { EXTRACT_DAY_SYSTEM_PROMPT, EXTRACT_PERSON_SYSTEM_PROMPT, buildExtractCompactPrompt } from "./extractorCompact";
import { TOPICS_SYSTEM_PROMPT } from "../topics";
import { MEMORY_FILES_SYSTEM_PROMPT } from "../memoryFiles";
import { PATTERNS_SYSTEM_PROMPT } from "../patterns";
import { REVIEW_SYSTEM_PROMPT, buildReviewUserPrompt } from "./review";
import { MONTHLY_SYSTEM_PROMPT, buildMonthlyUserPrompt } from "./monthly";
import { FORTNIGHT_SYSTEM_PROMPT, buildFortnightUserPrompt } from "./fortnightly";
import { compactDayLine } from "../compactDays";
import { estimateTokens } from "../tokens";
import type { AgendaItem } from "../../db/types";

// The app's TypeScript settings have no Node types; these tests run in Node.
declare const process: { env: Record<string, string | undefined> };

const run = process.env.EMBER_PROMPT_REVIEW ? it : it.skip;

// ---------- sample data (made up) ----------

const checkIn = [
  "- mood: 5/10",
  "- energy: 4/10",
  "- in bed 00:30, up 07:15",
  '- feeling, in their words: "tired, a bit tense"',
  '- on their mind: "the call with Dad"',
  '- what they did, waking up → lunch, in their words: "lab work, the centrifuge broke again"',
  "- lunch: 13:10",
].join("\n");
const dayParts = ["1. waking up (07:15) → lunch (13:10)", "2. lunch (13:10) → now"].join("\n");
const notes = "- 11:02: centrifuge broke, lost the morning's samples\n- 17:40: called Dad, didn't argue this time";

const full: CounselorPromptLayers = {
  userName: "Abhi",
  todayLine: "Thursday, 2026-09-17",
  profileSummary: "A PhD student in the third year, living away from family; close to his sister; runs to clear his head.",
  memorySummary: "Summary #3, covering entries from 2026-08-18 to 2026-08-31.\nOverview: Thesis pressure and arguments with Dad about moving.",
  recentJournals: "2026-09-15 — The long wait\nThe supervisor meeting moved again; spent the evening on the couch.",
  checkIn,
  dayParts,
  style: { tone: "balanced", approach: "coach" },
  topObservations: "- person:Dad — 9×, last 2026-09-15, negative\n- habit:gym — 6×, last 2026-09-12, positive",
  yesterdaySummaryLine: "Quiet day of writing, low energy.",
  pendingCaptures: notes,
  neglectedDomains: "body (sleep, food, movement)",
  openThreads: "- arguments with Dad (last came up 2026-09-15)",
  topics: "- [dispute-with-dad] Dispute with Dad, last talked about 2026-09-15\n    They argue about moving out; he feels unheard.\n    next: whether the Thursday call happened",
  memoryFiles: "People:\n- Dad — arguments about moving out; calls often end badly\n- Meera (sister) — the one he calls when stressed",
  weeklyLetter: "(none)",
  documents: "(none)",
  daysSinceLastEntry: 2,
};

const agenda: AgendaItem[] = [
  { id: "p1", section: "past", text: "Whether the call with Dad happened", state: "open", topic: "dispute-with-dad" },
  { id: "t1", section: "today", text: "The broken centrifuge and the lost samples", state: "open" },
  { id: "f1", section: "future", text: "Friday's supervisor meeting", state: "skip" },
];

const compact: CompactPromptLayers = {
  userName: "Abhi",
  todayLine: "Thursday, 2026-09-17",
  style: { tone: "balanced", approach: "therapist" },
  briefing:
    "- Lost the morning's samples when the centrifuge broke; tense since.\n- Called Dad and didn't argue: a first after weeks of fights about moving out.\n- Sleep short (about 6h). Start with the call with Dad.",
  checkIn,
  dayParts,
  notes,
  memory: "People:\n- Dad — arguments about moving out; calls often end badly\nTopics you are working through:\n- Dispute with Dad: they argue about moving out. Next: whether the Thursday call happened",
};

const rawDay = JSON.stringify({
  mood: 5,
  energy: 4,
  sleep_hours: 6,
  summary_line: "Lab setback, then a calm call with Dad.",
  themes: [{ key: "lab work", sentiment: -0.5 }, { key: "family", sentiment: 0.3 }],
  habits: [{ key: "gym", done: false }],
  people: [{ key: "Dad", sentiment: 0.4 }],
  emotions_named: ["tense"],
  struggles_shown: ["frustration with equipment"],
});

// ---------- the document ----------

const sections: string[] = [];
const add = (title: string, intro: string, blocks: [string, string][]) => {
  const body = blocks.map(([label, text]) => `**${label}** (about ${estimateTokens(text)} tokens)\n\n\`\`\`text\n${text}\n\`\`\``).join("\n\n");
  sections.push(`## ${title}\n\n${intro}\n\n${body}`);
};

run("writes prompt-review/PROMPTS.md", async () => {
  add(
    "1. Conversation, big models (Claude, GPT)",
    "Sent as the system prompt for the whole conversation. Coach style shown; therapist and friend differ only in \"HOW THE CONVERSATION FLOWS\" (section 2). File: `src/ai/prompts/counselor.ts`.",
    [
      ["System prompt (coach)", counselorSystemPrompt(full)],
      [
        "Line added to each of their messages",
        counselorTurnPreamble({ nowTime: "21:15", exchangeCount: 2, lengthPreference: "standard", agenda: formatAgendaForPreamble(agenda) }),
      ],
    ],
  );

  const flowOf = (approach: "friend" | "therapist") => {
    const p = counselorSystemPrompt({ ...full, style: { tone: "balanced", approach } });
    return p.slice(p.indexOf("HOW THE CONVERSATION FLOWS"), p.indexOf("HOW YOU TALK"));
  };
  add("2. How the conversation flows, per approach", "The part of section 1 that changes with the approach.", [
    ["Therapist-style", flowOf("therapist").trim()],
    ["Friend", flowOf("friend").trim()],
  ]);

  add(
    "3. Tones and approaches",
    "What each choice in Settings > Conversation puts in the prompt. File: `src/ai/prompts/style.ts`.",
    [...TONES.map((t) => [`Tone: ${t.label}`, t.instruction] as [string, string]), ...APPROACHES.map((a) => [`Approach: ${a.label}`, a.instruction] as [string, string])],
  );

  add(
    "4. Conversation, small models (local, free hosted, phone via computer)",
    "Compact mode. The briefing comes from the preparation step (section 5); the memory lines are picked by matching today's words. Therapist style shown. File: `src/ai/prompts/counselorCompact.ts`.",
    [
      ["System prompt (therapist-style)", counselorCompactPrompt(compact)],
      [
        "Line added to their message once the chat is too long for the model",
        `${counselorTurnPreamble({ nowTime: "22:05", exchangeCount: 9, lengthPreference: "standard", agenda: formatAgendaForPreamble(agenda) })}\n[EARLIER IN THIS CONVERSATION — a summary from the app, not their words:\n- Lost samples; felt useless all morning.\n- Call with Dad went calmly; relieved.]`,
      ],
    ],
  );

  add(
    "5. Preparation before a conversation, small models",
    "One call before the first reply: the briefing, plus the checklist in coach and therapist styles. File: `src/ai/prepare.ts`.",
    [
      ["System prompt (therapist, with checklist)", prepSystemPrompt(true, "therapist")],
      ["System prompt (friend, briefing only)", prepSystemPrompt(false, "friend")],
    ],
  );

  add("6. Checklist, big models", "Coach and therapist styles. File: `src/ai/agenda.ts`.", [["System prompt", AGENDA_SYSTEM_PROMPT]]);

  add("7. Rolling summary of a long chat, small models", "File: `src/ai/window.ts`.", [["System prompt", CHAT_SUMMARY_SYSTEM_PROMPT]]);

  add("8. Journal entry", "File: `src/ai/prompts/journal.ts`.", [
    ["System prompt", JOURNAL_SYSTEM_PROMPT],
    [
      "Their material (sample)",
      buildJournalUserPrompt({
        date: "2026-09-17",
        captures: [{ created_at: "2026-09-17T11:02:00", text: "centrifuge broke, lost the morning's samples", mood_emoji: "😠" }],
        transcript: [
          { role: "assistant", content: "Your note says the centrifuge broke. What happened then?" },
          { role: "user", content: "Lost everything from the morning. I just sat there for an hour." },
        ],
        profileSummary: full.profileSummary,
        checkIn,
        voice: "first",
        writingStyle: "Short sentences. Dry. I don't do exclamation marks.",
      }),
    ],
  ]);

  const extractInput = {
    date: "2026-09-17",
    entry: { title: "Samples lost, Dad found", narrative: "The centrifuge broke before noon...", highlights: ["A calm call with Dad"], counselorNote: "Calmer than you expected." },
    transcript: [{ role: "user" as const, content: "Lost everything from the morning." }],
    knownNames: { themes: ["lab work", "family"], habits: ["gym"], people: ["Dad", "Meera"], activities: ["run"] },
    dismissedHabits: ["late scrolling"],
    checkIn,
  };
  add("9. Reading an entry for Insights", "Big models: one job. Small models: two short jobs. Files: `src/ai/prompts/extractor.ts`, `extractorCompact.ts`.", [
    ["System prompt (big models)", EXTRACTOR_SYSTEM_PROMPT],
    ["Material (big models)", buildExtractorUserPrompt(extractInput)],
    ["System prompt, part 1 of 2 (small models)", EXTRACT_DAY_SYSTEM_PROMPT],
    ["System prompt, part 2 of 2 (small models)", EXTRACT_PERSON_SYSTEM_PROMPT],
    ["Material (small models)", buildExtractCompactPrompt(extractInput, "- Lost everything from the morning.")],
  ]);

  add("10. Memory", "Topics after each coach or therapist conversation; the memory files once a week. Files: `src/ai/topics.ts`, `src/ai/memoryFiles.ts`.", [
    ["Topics, system prompt", TOPICS_SYSTEM_PROMPT],
    ["Memory files, system prompt", MEMORY_FILES_SYSTEM_PROMPT],
  ]);

  add("11. Suggestions and habit links", "The app counts the links; the model chooses and phrases them. File: `src/ai/patterns.ts`.", [
    ["System prompt", PATTERNS_SYSTEM_PROMPT],
  ]);

  add("12. Weekly review", "Small models get one line per day (shown) instead of the JSON record. File: `src/ai/prompts/review.ts`.", [
    ["System prompt", REVIEW_SYSTEM_PROMPT],
    [
      "Material (small models)",
      buildReviewUserPrompt({
        weekStart: "2026-09-14",
        weekEnd: "2026-09-20",
        days: [{ date: "2026-09-17", rawJson: compactDayLine(rawDay) }],
        currentProfile: full.profileSummary,
        currentStrengths: "[]",
        currentFocusAreas: "[]",
        userName: "Abhi",
      }),
    ],
  ]);

  add("13. Monthly report", "File: `src/ai/prompts/monthly.ts`.", [
    ["System prompt", MONTHLY_SYSTEM_PROMPT],
    [
      "Material (small models)",
      buildMonthlyUserPrompt({
        userName: "Abhi",
        stats: { month: "2026-09", daysJournaled: 14, avgMood: 5.6, avgEnergy: 4.9, topTheme: { key: "lab work", count: 9 }, bestWeek: null },
        previous: null,
        days: [{ date: "2026-09-17", rawJson: compactDayLine(rawDay) }],
      }),
    ],
  ]);

  add("14. Fortnightly memory summary", "Small models get each day's summary line instead of the full entry. File: `src/ai/prompts/fortnightly.ts`.", [
    ["System prompt", FORTNIGHT_SYSTEM_PROMPT],
    [
      "Material (small models)",
      buildFortnightUserPrompt({
        userName: "Abhi",
        number: 4,
        previous: full.memorySummary,
        numbers: { from: "2026-09-01", to: "2026-09-14", entries: 11, avgMood: 5.8, avgEnergy: 5.1, avgSleepHours: 6.4 },
        entries: [{ date: "2026-09-12", title: "Gym again", narrative: "Back at the gym after two weeks.", highlights: ["Felt strong"], summaryLine: "Back at the gym." }],
        assessments: [],
      }),
    ],
  ]);

  const doc = `# Ember's prompts, for review

Generated ${new Date().toISOString().slice(0, 10)} from the code of ember-desktop. The phone app uses the same prompt files.
Sample data is made up. Token counts are estimates.

**Big models** (Claude, GPT) get the full prompts. **Small models** (a local model, a free hosted tier, the phone going
through the computer) get compact mode: a shorter conversation prompt, a briefing written before the conversation,
only the memory lines that match today, a rolling summary of long chats, and Insights in smaller steps. Settings >
"How much Ember sends the model" can force either.

${sections.join("\n\n---\n\n")}
`;
  const fsModule = "node:fs";
  const fs = (await import(/* @vite-ignore */ fsModule)) as { mkdirSync: (p: string, o: object) => void; writeFileSync: (p: string, d: string) => void };
  fs.mkdirSync("../prompt-review", { recursive: true });
  fs.writeFileSync("../prompt-review/PROMPTS.md", doc);
});
