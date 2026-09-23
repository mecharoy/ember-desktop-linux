import { fetch } from "@tauri-apps/plugin-http";
import type { AIProvider, ChatMessage } from "../types";
import { applyTurnPreamble, ProviderError } from "../types";
import { createReasoningFilter, stripReasoning } from "./reasoning";
import { fetchWithRetry, TRANSIENT_STATUSES } from "./retry";
import { estimateTokens } from "../tokens";

export interface OpenAiCompatibleConfig {
  /** Full chat-completions URL, e.g. http://localhost:11434/v1/chat/completions */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer …`. Omitted for localhost, which needs none. */
  apiKey?: string;
  /** Ceiling on the reply, sent as `max_tokens`. Omitted when unset, which
   *  lets the endpoint use its own default — fine locally, but hosted free
   *  tiers refuse a request whose *expected* output exceeds their per-minute
   *  output allowance, so for those it must be set and kept under the cap. */
  maxTokens?: number;
  /** Most a background job may ask for (ChatOptions.maxTokens is capped
   *  here). Unset: a job gets what it asks for. */
  jobMaxTokens?: number;
  /** A free tier's tokens-per-minute allowance, when it counts the prompt and
   *  the requested reply together (Groq). A job's reply is shrunk to fit. */
  tokensPerMinute?: number;
  /** Extra body fields for this endpoint only — provider-specific switches
   *  such as Groq's `reasoning_effort`. Never sent to an endpoint that was
   *  not declared with them, since an unknown field is a 400 on some. */
  extraBody?: Record<string, unknown>;
  /** The body field the reply ceiling goes in. OpenAI's own newer models
   *  take only max_completion_tokens. Default max_tokens. */
  tokenField?: "max_tokens" | "max_completion_tokens";
  /** Only changes the wording of the errors, never the request. */
  kind: "local" | "cloud";
}

const UNREACHABLE_HINT: Record<OpenAiCompatibleConfig["kind"], string> = {
  local:
    "Is Ollama/LM Studio running? Note: Elytra's security policy only allows " +
    "localhost endpoints (http://localhost:… or http://127.0.0.1:…) — LAN or " +
    "remote URLs are blocked. Check Settings > Local endpoint base URL.",
  cloud:
    "Check the endpoint address in Settings. Elytra's network policy only allows " +
    "the providers listed there — any other host is blocked, even with a valid key.",
};

function toOpenAiMessages(messages: ChatMessage[], system: string) {
  return [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
}

/** Smallest reply worth sending a job for; below it the reply would be cut off. */
export const MIN_JOB_REPLY_TOKENS = 1200;


/** The max_tokens to send. A chat turn uses the usual ceiling; a job gets
 *  what it asks for, but never past the job ceiling nor past what is left of
 *  a tokens-per-minute allowance after the prompt. Undefined sends none. */
export function replyCeiling(
  config: Pick<OpenAiCompatibleConfig, "maxTokens" | "jobMaxTokens" | "tokensPerMinute">,
  wanted?: number,
  promptTokens = 0,
): number | undefined {
  if (!wanted) return config.maxTokens;
  let ceiling = config.jobMaxTokens ? Math.min(wanted, config.jobMaxTokens) : wanted;
  if (config.tokensPerMinute) ceiling = Math.min(ceiling, config.tokensPerMinute - promptTokens);
  return ceiling;
}

async function callEndpoint(
  config: OpenAiCompatibleConfig,
  messages: ChatMessage[],
  system: string,
  stream: boolean,
  wantedTokens?: number,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const outgoing = toOpenAiMessages(messages, system);
  const maxTokens = replyCeiling(config, wantedTokens, estimateTokens(JSON.stringify(outgoing)));
  // Refuse only when the allowance cut the reply below what the job needs.
  // A short job (the checklist asks for 600) is sent as asked.
  if (wantedTokens && maxTokens !== undefined && maxTokens < Math.min(wantedTokens, MIN_JOB_REPLY_TOKENS)) {
    throw new ProviderError(
      "This is too much for the free tier to take in one go.",
      "The free tier counts what Elytra sends and the reply together, and this job needs more than it allows a minute. " +
        "Gemini (Google AI Studio) has room for it: switch in Settings > AI provider.",
    );
  }
  const body = JSON.stringify({
    model: config.model,
    stream,
    ...(maxTokens ? { [config.tokenField ?? "max_tokens"]: maxTokens } : {}),
    ...(config.extraBody ?? {}),
    messages: outgoing,
  });
  let res: Response;
  let attempts = 1;
  try {
    ({ res, attempts } = await fetchWithRetry(() => fetch(config.baseUrl, { method: "POST", headers, body })));
  } catch {
    throw new ProviderError(`Could not reach the endpoint at ${config.baseUrl}.`, UNREACHABLE_HINT[config.kind]);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message ?? body?.error ?? "";
    } catch {
      // non-JSON error body — the status code alone will have to do
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        `The endpoint rejected the API key (${res.status}).`,
        detail ? String(detail) : "Paste a fresh key in Settings, and check it belongs to this provider.",
      );
    }
    if (res.status === 429) {
      // Two different 429s: "you have used your quota, wait" and "this single
      // request asks for more output than your tier allows". Only the first
      // one is worth waiting out, so they must not read the same.
      if (/request too large|max_tokens|expected output/i.test(String(detail))) {
        throw new ProviderError(
          "The free tier refused the request for asking for too long a reply (429).",
          `${String(detail)} — lower "Longest reply" in Settings > AI provider.`,
        );
      }
      throw new ProviderError(
        "The provider's free-tier limit was hit (429).",
        detail
          ? String(detail)
          : "Free tiers cap requests per minute and per day. Wait a bit, or switch model/provider in Settings.",
      );
    }
    if (TRANSIENT_STATUSES.has(res.status)) {
      // Busy on the provider's side (Gemini's free tier answers 503 when a
      // model is out of capacity). Already retried with backoff by now.
      const gemini = config.baseUrl.includes("generativelanguage.googleapis.com");
      throw new ProviderError(
        `The provider is overloaded right now (${res.status}), still after ${attempts} tries.`,
        [
          detail ? String(detail) : "",
          "This is on their side and usually passes within a minute. Press Retry",
          gemini
            ? "or pick another service in Settings > AI provider."
            : "or switch model or service in Settings > AI provider.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    if (res.status === 404) {
      // Nearly always the model name, not the URL: hosted providers retire
      // model ids on a schedule, so a preset that worked last month 404s.
      throw new ProviderError(
        `The endpoint returned 404 — the model "${config.model}" may not exist there.`,
        String(detail) ||
          (config.kind === "local"
            ? `Try \`ollama pull ${config.model}\`, or fix the model name in Settings.`
            : "Hosted providers retire model names. Check the provider's model list and fix the name in Settings."),
      );
    }
    throw new ProviderError(
      `Endpoint error (${res.status}).`,
      String(detail) || "Check the endpoint address and model name in Settings.",
    );
  }

  return res;
}

/**
 * Any OpenAI-compatible /v1/chat/completions endpoint. Two providers are
 * built on it: `local` (Ollama/LM Studio, no key, fully offline) and `cloud` (a hosted free tier reached with a bearer token).
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AIProvider {
  return {
    async *chatStream(messages, system, options) {
      const res = await callEndpoint(
        config,
        applyTurnPreamble(messages, options?.turnPreamble),
        system,
        true,
      );
      const body = res.body;
      if (!body) throw new ProviderError("The endpoint's response had no stream body.");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      const reasoning = createReasoningFilter();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // OpenAI-style SSE: one `data: {...}` JSON per line, `data: [DONE]` ends.
          let nl = buffer.indexOf("\n");
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf("\n");
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const event = JSON.parse(payload);
              const text = event?.choices?.[0]?.delta?.content;
              if (typeof text === "string" && text.length > 0) {
                const shown = reasoning.push(text);
                if (shown.length > 0) yield shown;
              }
            } catch {
              // partial JSON split across chunks — rare with line-delimited SSE,
              // but skipping a malformed line beats killing the stream
            }
          }
        }
        const tail = reasoning.flush();
        if (tail.length > 0) yield tail;
      } finally {
        // Consumer stopped early (user hit Stop) — close the HTTP stream.
        reader.cancel().catch(() => {});
      }
    },

    async complete(messages, system, options) {
      const res = await callEndpoint(
        config,
        applyTurnPreamble(messages, options?.turnPreamble),
        system,
        false,
        options?.maxTokens,
      );
      const json = await res.json();
      if (json?.choices?.[0]?.finish_reason === "length") {
        throw new ProviderError(
          "The reply was cut off before it was finished.",
          'It ran into the reply length limit. Raise "Longest reply" in Settings > AI provider, or pick a service with a bigger free tier.',
        );
      }
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.length > 0) return stripReasoning(text);
      throw new ProviderError("The endpoint's response did not contain text content.");
    },
  };
}
