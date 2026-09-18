import { z } from "zod";
import { getProvider } from "./factory";
import { extractJson } from "./json";
import { JOB_REPLY_TOKENS } from "./replySizes";
import { contextBudget } from "./budget";
import { estimateTokens } from "./tokens";
import { fitTranscript } from "./window";
import { getConversationPrep } from "../db/agendas";
import {
  JOURNAL_SYSTEM_PROMPT,
  buildJournalUserPrompt,
  type JournalPromptInput,
} from "./prompts/journal";

const JournalEntrySchema = z.object({
  title: z.string().min(1).max(120),
  narrative: z.string().min(1),
  highlights: z.array(z.string().min(1)).min(1).max(6),
  counselor_note: z.string().min(1),
});

export type JournalEntryDraft = z.infer<typeof JournalEntrySchema>;

export type JournalInput = JournalPromptInput;

export type JournalResult =
  | { ok: true; entry: JournalEntryDraft }
  | { ok: false; error: string };

/**
 * Generates a journal entry, validated against JournalEntrySchema:
 * structured output is validated, retried once with the parse
 * error appended, then degrades gracefully — the caller is expected to fall
 * back to a manual template on { ok: false }, never lose the day's captures.
 */
export async function generateJournalEntry(input: JournalInput): Promise<JournalResult> {
  const provider = await getProvider();
  const basePrompt = buildJournalUserPrompt(await fitJournalInput(input));

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response could not be parsed as valid JSON matching the required shape: ${lastError}\nReturn ONLY the corrected JSON object, nothing else.`;

    try {
      const raw = await provider.complete([{ role: "user", content: prompt }], JOURNAL_SYSTEM_PROMPT, {
        maxTokens: JOB_REPLY_TOKENS.journal,
      });
      const parsed = extractJson(raw);
      const entry = JournalEntrySchema.parse(parsed);
      return { ok: true, entry };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, error: lastError };
}

/** Small models: a writing sample of at most ~400 tokens, and the
 *  conversation shortened until the whole request fits (their words first). */
export async function fitJournalInput(input: JournalInput): Promise<JournalInput> {
  const budget = await contextBudget();
  if (budget.mode === "full") return input;
  const small = { ...input, writingStyle: input.writingStyle ? input.writingStyle.slice(0, 1400) : input.writingStyle };
  const withoutChat = estimateTokens(JOURNAL_SYSTEM_PROMPT) + estimateTokens(buildJournalUserPrompt({ ...small, transcript: [] }));
  const room = budget.totalTokens - JOB_REPLY_TOKENS.journal - withoutChat - 100;
  const summary = input.date ? ((await getConversationPrep(input.date))?.chatSummary ?? null) : null;
  return { ...small, transcript: fitTranscript(input.transcript, Math.max(400, room), summary) };
}
