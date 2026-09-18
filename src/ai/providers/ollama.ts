import type { AIProvider, ChatMessage } from "../types";
import { applyTurnPreamble, ProviderError } from "../types";
import { createReasoningFilter, stripReasoning } from "./reasoning";

// Ollama's own chat API (/api/chat), used instead of its OpenAI-style one
// because only this one takes the context size. Ollama's default is small,
// and a prompt longer than the context is cut from the front without an
// error, which would silently drop the start of the evening's notes.
// The same file is in ember-desktop and ember-mobile.

/** How long Ollama keeps the model loaded after a request. */
export const OLLAMA_KEEP_ALIVE = "15m";
export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
export const DEFAULT_NUM_CTX = 8192;

/** Sends one /api/chat body and yields the reply's lines (one JSON object
 *  each). Throws ProviderError when the request fails. Stopping the loop
 *  early must close the request. */
export type OllamaTransport = (body: Record<string, unknown>) => AsyncIterable<string>;

export interface OllamaConfig {
  model: string;
  numCtx?: number;
  transport: OllamaTransport;
}

function toOllamaMessages(messages: ChatMessage[], system: string) {
  return [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
}

interface OllamaLine {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

function parseLine(line: string): OllamaLine | null {
  try {
    return JSON.parse(line) as OllamaLine;
  } catch {
    return null;
  }
}

/** A refusal of the `think` field, from a model or Ollama that doesn't take it. */
function refusesThink(e: unknown): boolean {
  return e instanceof ProviderError && /think/i.test(`${e.message} ${e.hint ?? ""}`);
}

export function createOllamaProvider(config: OllamaConfig): AIProvider {
  // Thinking is switched off: thinking models (Qwen 3.5, Gemma 4…) otherwise
  // reason out of sight for minutes before the first visible word, measured
  // at over three minutes for one opening line, against under a second without.
  const body = (messages: ChatMessage[], system: string, think: boolean) => ({
    model: config.model,
    stream: true,
    keep_alive: OLLAMA_KEEP_ALIVE,
    ...(think ? {} : { think: false }),
    options: { num_ctx: config.numCtx ?? DEFAULT_NUM_CTX },
    messages: toOllamaMessages(messages, system),
  });

  /** The reply's lines; asked again with thinking left to the model if the
   *  request is refused for the think field before anything arrived. */
  async function* lines(messages: ChatMessage[], system: string): AsyncGenerator<string> {
    let got = false;
    try {
      for await (const line of config.transport(body(messages, system, false))) {
        got = true;
        yield line;
      }
    } catch (e) {
      if (got || !refusesThink(e)) throw e;
      yield* config.transport(body(messages, system, true));
    }
  }

  return {
    async *chatStream(messages, system, options) {
      const reasoning = createReasoningFilter();
      for await (const line of lines(applyTurnPreamble(messages, options?.turnPreamble), system)) {
        const event = parseLine(line);
        if (!event) continue;
        if (event.error) throw new ProviderError(`The local model stopped: ${event.error}`);
        const text = event.message?.content;
        if (text) {
          const shown = reasoning.push(text);
          if (shown.length > 0) yield shown;
        }
        if (event.done) break;
      }
      const tail = reasoning.flush();
      if (tail.length > 0) yield tail;
    },

    async complete(messages, system, options) {
      let text = "";
      let reason = "";
      // Streamed even here: a long entry on a slow computer would otherwise
      // sit in one silent request that some networks give up on.
      for await (const line of lines(applyTurnPreamble(messages, options?.turnPreamble), system)) {
        const event = parseLine(line);
        if (!event) continue;
        if (event.error) throw new ProviderError(`The local model stopped: ${event.error}`);
        text += event.message?.content ?? "";
        if (event.done) {
          reason = event.done_reason ?? "";
          break;
        }
      }
      if (reason === "length") {
        throw new ProviderError(
          "The reply was cut off before it was finished.",
          "The model ran out of room. Raise the context size in Settings > AI provider.",
        );
      }
      const clean = stripReasoning(text);
      if (clean.trim().length === 0) throw new ProviderError("The local model returned an empty reply.");
      return clean;
    },
  };
}

/** What a Rust chat command streams back: the HTTP status, then Ollama's
 *  reply lines, then done (or an error). */
export type ChatEvent =
  | { kind: "status"; status: number; error: string | null }
  | { kind: "line"; line: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Turns a stream of ChatEvents into reply lines. `start` begins the request
 * and hands each event to its callback; `cancel` stops it. Leaving the loop
 * early (Stop pressed, an error, `signal` aborted) cancels the request.
 */
export async function* linesFromEvents(opts: {
  start: (onEvent: (event: ChatEvent) => void) => Promise<unknown>;
  cancel: () => void;
  statusError: (status: number, detail: string | null) => ProviderError;
  failure: (message: string) => ProviderError;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const queue: ChatEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (event: ChatEvent) => {
    queue.push(event);
    wake?.();
  };
  const onAbort = () => push({ kind: "error", message: "aborted" });
  if (opts.signal?.aborted) throw new ProviderError("Stopped to make room for the conversation.");
  opts.signal?.addEventListener("abort", onAbort);
  opts.start(push).catch((e) => push({ kind: "error", message: String(e) }));

  let finished = false;
  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      const event = queue.shift()!;
      if (event.kind === "status") {
        if (event.status !== 200) throw opts.statusError(event.status, event.error);
      } else if (event.kind === "line") {
        yield event.line;
      } else if (event.kind === "done") {
        finished = true;
        return;
      } else if (opts.signal?.aborted) {
        throw new ProviderError("Stopped to make room for the conversation.");
      } else {
        throw opts.failure(event.message);
      }
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    if (!finished) opts.cancel();
  }
}
