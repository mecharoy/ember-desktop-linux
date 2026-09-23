import { getAllSettings } from "../db/settings";
import { getApiKey, getCloudApiKey, getOpenAiKey } from "../secrets";
import { createOpenAiProvider } from "./providers/openai";
import { createAnthropicProvider } from "./providers/anthropic";
import { createClaudeSubscriptionProvider } from "./providers/claudeSubscription";
import { createCodexSubscriptionProvider } from "./providers/codexSubscription";
import { createCloudProvider, presetForBaseUrl, DEFAULT_CLOUD_MAX_TOKENS } from "./providers/cloud";
import { createLocalProvider } from "./providers/local";
import { createOllamaProvider, DEFAULT_NUM_CTX } from "./providers/ollama";
import { localOllamaTransport } from "./providers/localOllama";
import { backgroundSignal } from "./modelActivity";
import type { AIProvider } from "./types";
import { ProviderError } from "./types";

export const DESKTOP_PROVIDERS = ["local", "cloud", "claude-subscription", "codex-subscription", "anthropic", "openai"] as const;

/** The context size setting as a number, within what Ollama accepts. */
export function numCtxSetting(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 2048 ? Math.min(Math.round(n), 131072) : DEFAULT_NUM_CTX;
}

/**
 * Reads Settings and returns the configured provider.
 * - "local": a model on this computer. Ollama by default (Elytra starts it and
 *   keeps the model loaded, see localModel.ts); or any OpenAI-style server
 *   such as LM Studio. Nothing leaves the computer.
 * - "cloud": a hosted OpenAI-compatible endpoint with a free tier (Groq,
 *   Gemini, OpenRouter…). Free, but the text leaves the machine.
 * - "claude-subscription": the `claude` CLI, using a Pro/Max plan.
 * - "codex-subscription": the `codex` CLI, using a ChatGPT plan.
 * - "anthropic": console.anthropic.com API key, billed pay-as-you-go.
 * - "openai": an OpenAI API key (ChatGPT's models), billed pay-as-you-go.
 */
export async function getProvider(): Promise<AIProvider> {
  const settings = await getAllSettings();

  switch (settings.provider) {
    case "local":
      if (settings.local_server === "openai") {
        return createLocalProvider({ baseUrl: settings.api_base, model: settings.model || "llama3.1:8b" });
      }
      if (!settings.model) {
        throw new ProviderError("No local model picked.", "Choose one in Settings > AI provider.");
      }
      return createOllamaProvider({
        model: settings.model,
        numCtx: numCtxSetting(settings.local_num_ctx),
        transport: localOllamaTransport(settings.ollama_host, backgroundSignal()),
      });
    case "claude-subscription":
      return createClaudeSubscriptionProvider();
    case "codex-subscription":
      return createCodexSubscriptionProvider();
    case "openai":
      return createOpenAiProvider({ apiKey: await getOpenAiKey(), model: settings.model });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: await getApiKey(),
        model: settings.model || "claude-sonnet-5",
      });
    case "cloud":
    default:
      return createCloudProvider({
        baseUrl: settings.cloud_api_base,
        model: settings.model || "qwen/qwen3.6-27b",
        apiKey: await getCloudApiKey(),
        maxTokens:
          Number(settings.cloud_max_tokens) ||
          presetForBaseUrl(settings.cloud_api_base)?.maxTokens ||
          DEFAULT_CLOUD_MAX_TOKENS,
      });
  }
}
