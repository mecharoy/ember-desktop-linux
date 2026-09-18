import type { AIProvider } from "../types";
import { ProviderError } from "../types";
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

export interface LocalConfig {
  baseUrl: string; // e.g. http://localhost:11434/v1/chat/completions
  model: string;
}

/**
 * LocalProvider — any OpenAI-compatible /v1/chat/completions endpoint on this
 * machine (Ollama, LM Studio). Fully offline:
 * with this selected, nothing ever leaves the computer. The network policy in
 * src-tauri/capabilities/default.json enforces the localhost-only part.
 */
export function createLocalProvider(config: LocalConfig): AIProvider {
  if (!config.baseUrl) {
    throw new ProviderError("No local endpoint configured.", "Set the server address in Settings > AI provider.");
  }
  return createOpenAiCompatibleProvider({ ...config, kind: "local" });
}
