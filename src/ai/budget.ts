// How much Ember sends the model. Big hosted models (Claude, GPT) get
// everything: the full prompt, every memory layer, the whole conversation.
// Small or rate-limited ones (a local model, a free hosted tier, the phone
// going through the computer) get "compact" mode: a short prompt, a briefing
// written before the conversation, only the memory lines that match today, and
// a rolling chat window. Two reasons: a prompt longer than the model's window
// is cut from the front without an error (Ollama), and small models follow a
// long prompt badly. Settings > AI provider can force either mode.

import { getAllSettings } from "../db/settings";
import type { SettingKey } from "../db/types";
import { presetForBaseUrl } from "./providers/cloud";
import { DEFAULT_NUM_CTX } from "./providers/ollama";

export type ContextMode = "full" | "compact";

export interface ContextBudget {
  mode: ContextMode;
  /** Everything one request may hold, prompt and reply together. */
  totalTokens: number;
  /** Room kept free for the reply. */
  replyTokens: number;
}

/** Providers that get compact mode unless Settings says otherwise. */
const SMALL_PROVIDERS = new Set(["local", "cloud", "pc"]);


function numCtx(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 2048 ? Math.min(Math.round(n), 131072) : DEFAULT_NUM_CTX;
}

/** Pure: the budget for a set of settings. */
export function budgetFor(all: Record<SettingKey, string>): ContextBudget {
  // Read loosely: the phone has no local-model settings. Same file in both apps.
  const settings = all as Record<string, string | undefined>;
  const forced = settings.context_mode;
  const small = forced === "compact" || (forced !== "full" && SMALL_PROVIDERS.has(settings.provider ?? ""));
  switch (settings.provider) {
    case "local":
      return { mode: small ? "compact" : "full", totalTokens: numCtx(settings.local_num_ctx ?? ""), replyTokens: 700 };
    case "cloud": {
      const preset = presetForBaseUrl(settings.cloud_api_base ?? "");
      // A free tier's limit is per minute, not per request: stay well under it.
      const total = preset?.tokensPerMinute ? Math.floor(preset.tokensPerMinute * 0.8) : 16000;
      return { mode: small ? "compact" : "full", totalTokens: total, replyTokens: Number(settings.cloud_max_tokens) || preset?.maxTokens || 900 };
    }
    case "pc":
      // The computer sets its own context size; this is Ollama's usual one.
      return { mode: small ? "compact" : "full", totalTokens: DEFAULT_NUM_CTX, replyTokens: 700 };
    default:
      return { mode: small ? "compact" : "full", totalTokens: 180000, replyTokens: 2000 };
  }
}

export async function contextBudget(): Promise<ContextBudget> {
  return budgetFor(await getAllSettings());
}

/** How a compact conversation's request is shared out. */
export interface ConversationShares {
  /** Briefing, check-in, today's notes and memory lines. */
  context: number;
  /** The chat itself (older turns are summarised to fit). */
  history: number;
}

/** Fixed parts first: the rules of the compact prompt and the per-turn line. */
export function conversationShares(b: ContextBudget, rulesTokens: number): ConversationShares {
  const free = Math.max(1200, b.totalTokens - b.replyTokens - rulesTokens - 150);
  const context = Math.min(2200, Math.floor(free * 0.45));
  return { context, history: free - context };
}
