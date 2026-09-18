// A rolling window over the conversation, for small models (compact mode).
// The last exchanges go word for word; everything before them is carried as a
// short summary on the turn's SESSION STATE line. The summary is kept per day
// (session_agendas.chat_summary) and only extended when more of the chat has
// to be folded into it, so most turns cost no extra call.

import { getProvider } from "./factory";
import { contextBudget } from "./budget";
import { estimateTokens } from "./tokens";
import { clip } from "./relevance";
import { getConversationPrep, saveChatSummary } from "../db/agendas";
import type { ChatMessage } from "./types";

export const CHAT_SUMMARY_SYSTEM_PROMPT = `You keep a running summary of a conversation between
Ember (a companion who helps someone talk through their day) and them, for a
small AI model that can't reread all of it. Update the summary with the new
part of the conversation. At most 120 words, short lines starting with "- ":
what they told you (facts, feelings, in their words where it matters), what
has been covered, and anything left open or promised. Only what was said.
Reply with the summary only.`;

const tokensOf = (messages: ChatMessage[]) => messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);

/**
 * Where to cut: the most recent messages that fit `budget` (at least the last
 * two), starting on one of their messages. Returns the index of the first
 * kept message. Pure.
 */
export function windowStart(history: ChatMessage[], budget: number): number {
  let start = history.length;
  let used = 0;
  while (start > 0) {
    const cost = estimateTokens(history[start - 1].content) + 4;
    if (used + cost > budget && history.length - start >= 2) break;
    used += cost;
    start--;
  }
  while (start > 0 && start < history.length && history[start].role !== "user") start++;
  return start;
}

/**
 * The history and turn preamble to send. Full mode: unchanged. Compact mode:
 * when the chat no longer fits beside the system prompt, the oldest part is
 * summarised and the summary goes on the preamble.
 */
export async function fitTurn(opts: {
  date: string;
  system: string;
  history: ChatMessage[];
  preamble: string;
}): Promise<{ history: ChatMessage[]; preamble: string }> {
  const budget = await contextBudget();
  if (budget.mode === "full") return { history: opts.history, preamble: opts.preamble };

  const room = budget.totalTokens - budget.replyTokens - estimateTokens(opts.system) - estimateTokens(opts.preamble) - 250;
  if (tokensOf(opts.history) <= room) return { history: opts.history, preamble: opts.preamble };

  // Keep the recent part, with space left for the summary itself.
  const start = windowStart(opts.history, Math.max(300, room - 250));
  const prep = await getConversationPrep(opts.date);
  let summary = prep?.chatSummary ?? null;
  const covered = prep?.summaryUpto ?? 0;
  if (!summary || covered < start) {
    const from = summary ? covered : 0;
    const part = opts.history
      .slice(from, start)
      .map((m) => `${m.role === "user" ? "Them" : "Ember"}: ${m.content}`)
      .join("\n\n");
    const input = `${summary ? `THE SUMMARY SO FAR:\n${summary}\n\n` : ""}THE NEW PART OF THE CONVERSATION:\n${clip(part, Math.max(600, budget.totalTokens - 900))}\n\nWrite the updated summary.`;
    try {
      const provider = await getProvider();
      summary = (await provider.complete([{ role: "user", content: input }], CHAT_SUMMARY_SYSTEM_PROMPT, { maxTokens: 300 })).trim();
      await saveChatSummary(opts.date, summary, start);
    } catch {
      // No summary: the recent part still goes, the rest is dropped.
    }
  }
  const earlier = summary ? `\n[EARLIER IN THIS CONVERSATION — a summary from the app, not their words:\n${summary}]` : "";
  return { history: opts.history.slice(start), preamble: `${opts.preamble}${earlier}` };
}

/**
 * A conversation for a background job (journal entry, topics, extraction)
 * that has to fit `tokens`: their messages stay whole, Ember's are shortened
 * to their first sentence, and if it still doesn't fit, the oldest part is
 * replaced by the chat summary. Pure.
 */
export function fitTranscript<T extends { role: "user" | "assistant"; content: string }>(
  transcript: T[],
  tokens: number,
  summary: string | null = null,
): T[] {
  const cost = (list: T[]) => list.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
  if (cost(transcript) <= tokens) return transcript;
  const short = transcript.map((m) =>
    m.role === "assistant" ? { ...m, content: (m.content.match(/^[\s\S]*?[.!?](\s|$)/)?.[0] ?? m.content).slice(0, 220).trim() } : m,
  );
  if (cost(short) <= tokens) return short;
  const kept: T[] = [];
  let used = summary ? estimateTokens(summary) + 20 : 0;
  for (let i = short.length - 1; i >= 0; i--) {
    const c = estimateTokens(short[i].content) + 4;
    if (used + c > tokens) break;
    kept.unshift(short[i]);
    used += c;
  }
  if (summary) kept.unshift({ ...short[0], role: "user", content: `(Earlier in the conversation, summarised: ${summary})` });
  return kept;
}
