import { fetch } from "@tauri-apps/plugin-http";
import type { AIProvider, ChatMessage } from "../types";
import { applyTurnPreamble, ProviderError } from "../types";
import { fetchWithRetry, TRANSIENT_STATUSES } from "./retry";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Where people create a key (console.anthropic.com now redirects here). */
export const ANTHROPIC_KEYS_URL = "https://platform.claude.com/settings/keys";
// Sized for the largest job (weekly review: letter + cards + a ≤400-word
// profile rewrite); chat turns are short regardless — the prompt enforces that.
const MAX_TOKENS = 4096;

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

/**
 * Marks the two prefixes worth caching. This provider has no session to
 * resume — every turn re-sends the whole conversation — so without explicit
 * breakpoints all of it is billed as fresh input every single message, and
 * the cost of a chat grows with the square of its length.
 *
 *  1. The system prompt: the assembled memory layers, the largest stable
 *     block in the request. It only pays off because the prompt is now
 *     byte-identical across a session (see prompts/counselor.ts) — a clock
 *     ticking inside it would miss the cache on every turn.
 *  2. The last message of the previous turn: everything up to there is
 *     unchanged from last time, so it reads from cache and only the new user
 *     message is charged in full.
 *
 * Anthropic allows four breakpoints; two covers this. A prefix shorter than
 * the model's cache minimum is simply not cached — no error, no penalty.
 */
function buildRequestPayload(messages: ChatMessage[], system: string) {
  const cachePoint = messages.length - 2;
  return {
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: messages.map((m, i) =>
      i === cachePoint && m.content.length > 0
        ? {
            role: m.role,
            content: [
              { type: "text", text: m.content, cache_control: { type: "ephemeral" } },
            ],
          }
        : { role: m.role, content: m.content },
    ),
  };
}

async function callAnthropic(
  config: AnthropicConfig,
  messages: ChatMessage[],
  system: string,
  stream: boolean,
  wantedTokens?: number,
) {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: Math.max(MAX_TOKENS, wantedTokens ?? 0),
    stream,
    ...buildRequestPayload(messages, system),
  });
  let res: Response;
  try {
    ({ res } = await fetchWithRetry(() =>
      fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body,
      }),
    ));
  } catch {
    throw new ProviderError(
      "Could not reach the Anthropic API.",
      "Check your internet connection.",
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message ?? "";
    } catch {
      // ignore — fall through to the generic message below
    }
    if (res.status === 401) {
      throw new ProviderError(
        "Anthropic rejected the API key.",
        "Check Settings > Anthropic API key.",
      );
    }
    if (TRANSIENT_STATUSES.has(res.status)) {
      throw new ProviderError(
        `Anthropic is overloaded right now (${res.status}).`,
        "Elytra tried a few times. Press Retry in a minute.",
      );
    }
    if (res.status === 404) {
      throw new ProviderError(
        `Anthropic doesn't recognize the model "${config.model}".`,
        "Check the model name in Settings.",
      );
    }
    throw new ProviderError(
      `Anthropic API error (${res.status}).`,
      detail || "Check Settings and try again.",
    );
  }

  return res;
}

/**
 * AnthropicProvider — v1/messages via the Tauri http plugin (native reqwest
 * on the Rust side, so no browser CORS to fight).
 */
export function createAnthropicProvider(config: AnthropicConfig): AIProvider {
  if (!config.apiKey) {
    throw new ProviderError(
      "No Anthropic API key configured.",
      "Add one in Settings under 'Anthropic API key'.",
    );
  }

  return {
    async *chatStream(messages, system, options) {
      const res = await callAnthropic(
        config,
        applyTurnPreamble(messages, options?.turnPreamble),
        system,
        true,
      );
      const body = res.body;
      if (!body) {
        throw new ProviderError("Anthropic response had no stream body.");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIndex = buffer.indexOf("\n\n");
          while (sepIndex !== -1) {
            const rawEvent = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);

            const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
            sepIndex = buffer.indexOf("\n\n");
            if (!dataLine) continue;

            const payload = dataLine.slice(5).trim();
            if (!payload) continue;

            try {
              const event = JSON.parse(payload);
              if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta" &&
                typeof event.delta.text === "string"
              ) {
                yield event.delta.text as string;
              }
              if (event.type === "error") {
                throw new ProviderError(
                  event.error?.message ?? "Anthropic streamed an error event.",
                );
              }
            } catch (e) {
              if (e instanceof ProviderError) throw e;
              // Malformed/partial JSON in this chunk — the buffer keeps the
              // remainder and the next read() will complete it.
            }
          }
        }
      } finally {
        // Consumer stopped early (user hit Stop) — close the HTTP stream.
        reader.cancel().catch(() => {});
      }
    },

    async complete(messages, system, options) {
      const res = await callAnthropic(
        config,
        applyTurnPreamble(messages, options?.turnPreamble),
        system,
        false,
        options?.maxTokens,
      );
      const json = await res.json();
      if (json?.stop_reason === "max_tokens") {
        throw new ProviderError("The reply was cut off before it was finished.", "It ran into the reply length limit.");
      }
      const block = json?.content?.[0];
      if (block?.type === "text" && typeof block.text === "string") {
        return block.text as string;
      }
      throw new ProviderError("Anthropic response did not contain text content.");
    },
  };
}
