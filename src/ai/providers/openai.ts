import type { AIProvider } from "../types";
import { ProviderError } from "../types";
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// ChatGPT's models through the OpenAI API, with a pay-as-you-go key.
// api.openai.com is in the http allowlist (src-tauri/capabilities/default.json).

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";
/** Balanced price and quality for conversation (checked Sep 2026). */
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export function createOpenAiProvider(config: { apiKey: string; model: string }): AIProvider {
  if (!config.apiKey) {
    const missing = new ProviderError("No OpenAI API key yet.", "Add one in Settings > AI provider.");
    return {
      async *chatStream() {
        throw missing;
      },
      async complete() {
        throw missing;
      },
    };
  }
  return createOpenAiCompatibleProvider({
    baseUrl: OPENAI_CHAT_URL,
    model: config.model || DEFAULT_OPENAI_MODEL,
    apiKey: config.apiKey,
    // Newer OpenAI models take max_completion_tokens and refuse max_tokens.
    tokenField: "max_completion_tokens",
    kind: "cloud",
  });
}
