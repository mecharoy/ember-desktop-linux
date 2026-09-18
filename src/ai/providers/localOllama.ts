import { Channel, invoke } from "@tauri-apps/api/core";
import { ProviderError } from "../types";
import { DEFAULT_OLLAMA_HOST, linesFromEvents, type ChatEvent, type OllamaTransport } from "./ollama";

// Ollama on this computer, reached through Rust (local_model.rs local_chat).
// The webview can't call it directly: the installed app's pages come from
// http://tauri.localhost, and Ollama refuses requests from origins it
// doesn't know with a 403.

/** `signal` stops the request (a background job making way for a conversation). */
export function localOllamaTransport(host: string, signal?: AbortSignal): OllamaTransport {
  const base = (host.trim() || DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
  return (body) => {
    const requestId = crypto.randomUUID();
    return linesFromEvents({
      signal,
      start: (onEvent) => {
        const channel = new Channel<ChatEvent>();
        channel.onmessage = onEvent;
        return invoke("local_chat", { host: base, requestId, body, onEvent: channel });
      },
      cancel: () => void invoke("local_chat_cancel", { requestId }).catch(() => {}),
      statusError: (status, detail) =>
        status === 404
          ? new ProviderError(`Ollama doesn't have the model "${String(body.model)}".`, detail || `Run: ollama pull ${String(body.model)}`)
          : new ProviderError(`Ollama answered with an error (${status}).`, detail || undefined),
      failure: (message) =>
        new ProviderError(message, message.startsWith("Could not reach") ? "Check Settings > AI provider." : undefined),
    });
  };
}
