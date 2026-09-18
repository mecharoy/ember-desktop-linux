import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSetting } from "../../db/settings";
import type { AIProvider, ChatMessage, ChatOptions } from "../types";
import { applyTurnPreamble, ProviderError } from "../types";

const CLI_HINT = "Make sure Claude Code is installed and signed in (Settings > AI provider > Open Claude Code sign-in).";

/** Settings.claude_cli_path lets a user point at a specific claude binary
 * when auto-detection (PATH + known install locations) picks the wrong one
 * or can't find it at all. Empty string means "auto-detect". */
async function cliPathOverride(): Promise<string | undefined> {
  const path = await getSetting("claude_cli_path");
  return path.trim() || undefined;
}

export async function checkClaudeCli(): Promise<
  { ok: true; version: string; path: string } | { ok: false; message: string }
> {
  try {
    const cliPath = await cliPathOverride();
    const info = await invoke<{ version: string; path: string }>("claude_cli_version", { cliPath });
    return { ok: true, version: info.version, path: info.path };
  } catch (e) {
    return { ok: false, message: typeof e === "string" ? e : "claude CLI not found." };
  }
}

/** Polls checkClaudeCli() until it succeeds or timeoutMs elapses. Used right
 * after installClaudeCli() opens the installer, so the app can automatically
 * move on to signing in once the CLI actually appears on disk — the install
 * itself runs in a terminal we don't control, so polling is the only way to
 * know when it's done. Returns whether the CLI was found in time. */
export async function waitForClaudeCli(
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await checkClaudeCli();
    if (result.ok) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Opens a terminal running bare `claude` so its own first-run login flow —
 * which opens the Anthropic login page in the user's browser — takes over.
 * Ember never sees the OAuth token; the CLI writes its own credentials file. */
export async function openClaudeLogin(): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const cliPath = await cliPathOverride();
    const message = await invoke<string>("claude_open_login", { cliPath });
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: typeof e === "string" ? e : "Could not open the sign-in window." };
  }
}

/** Opens a terminal running the official Claude Code installer
 * (claude.ai/install.ps1 / install.sh) — the same command from
 * code.claude.com/docs/en/setup, just triggered with one click instead of
 * typed by hand. Use when checkClaudeCli() comes back not-ok because the CLI
 * genuinely isn't installed yet (as opposed to installed-but-undetected). */
export async function installClaudeCli(): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const message = await invoke<string>("claude_install");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: typeof e === "string" ? e : "Could not open the installer." };
  }
}

/**
 * Flattens messages into one plain-text prompt for `-p`. Used for the whole
 * transcript on a turn we can't resume (the first turn of a chat, a retry
 * after an error, the turn after a stop) and for just the new message on a
 * turn we can.
 */
function buildTranscriptPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) return "Begin.";
  const history = messages.slice(0, -1);
  const last = messages[messages.length - 1];
  if (history.length === 0) return last.content;

  const historyText = history
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return `Conversation so far:\n\n${historyText}\n\nUser: ${last.content}`;
}

interface StreamJsonLine {
  type?: string;
  session_id?: string;
  is_error?: boolean;
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

/**
 * A CLI session we can hand back to `--resume` on the next turn.
 *
 * Why this exists: every turn used to spawn a fresh stateless process and
 * replay the entire transcript, so the prompt cache was written and never
 * read — measured at zero cache-read tokens on every single message, with
 * the bill growing quadratically as the conversation went on. Resuming the
 * CLI's own session turns that prefix into a cache read (measured: 3,282
 * read / 61 written on turn two, ~14x cheaper) and means only the new
 * message crosses the wire.
 */
interface CliSession {
  id: string;
  /** How many of the caller's messages we had sent when this was recorded.
   *  The session also holds the reply it produced, hence the +1 below. */
  sent: number;
/** Cheap fingerprint of the messages this session covers. Taken over the
   *  caller's plain history — any per-turn decoration is added downstream of
   *  this, so the same conversation fingerprints the same way every turn and
   *  a rewound or rewritten history is caught. */
  signature: string;
  /** Resuming under a changed system prompt re-writes the whole cached
   *  prefix (measured: cache reads drop straight back to zero), so a changed
   *  prompt has to mean a fresh session. */
  system: string;
}

/** Keyed by ChatOptions.conversationId. Process-local and deliberately not
 *  persisted: a session id is only worth resuming while its cache is warm. */
const cliSessions = new Map<string, CliSession>();

function signature(messages: ChatMessage[], upto: number): string {
  const slice = messages.slice(0, upto);
  return `${slice.length}:${slice.reduce((n, m) => n + m.content.length, 0)}`;
}

/** Forget a conversation's CLI session, so the next turn starts a fresh one.
 *  Call it when the transcript is cleared or rebuilt behind the provider. */
export function forgetCliSession(conversationId: string): void {
  cliSessions.delete(conversationId);
}

/** Matches the shape documented at code.claude.com/docs/en/headless for
 *  `--output-format stream-json --verbose --include-partial-messages`. */
function extractDelta(line: StreamJsonLine): string | null {
  if (line.type === "stream_event" && line.event?.type === "content_block_delta") {
    const delta = line.event.delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }
  return null;
}

async function* stream(
  messages: ChatMessage[],
  system: string,
  options?: ChatOptions,
): AsyncIterable<string> {
  const requestId = crypto.randomUUID();
  const key = options?.conversationId;

  // Taken now, put back only on a clean finish. A turn that errored or was
  // stopped may have left a half-written exchange in the CLI's session, and
  // resuming into that would duplicate or truncate the conversation. Losing
  // one cache hit is much cheaper than corrupting the transcript.
  const previous = key ? cliSessions.get(key) : undefined;
  if (key) cliSessions.delete(key);

  const resumable =
    previous !== undefined &&
    previous.system === system &&
    messages.length > previous.sent + 1 &&
    signature(messages, previous.sent) === previous.signature;

  // Resuming: the session already holds everything up to and including its
  // own last reply, so only what came after it needs sending.
  const outgoing = applyTurnPreamble(messages, options?.turnPreamble);
  const prompt = resumable
    ? buildTranscriptPrompt(outgoing.slice(previous.sent + 1))
    : buildTranscriptPrompt(outgoing);

  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: ProviderError | null = null;
  let sessionId: string | null = null;
  let succeeded = false;

  const unlisten = await listen<{ kind: string; data?: string; message?: string }>(
    `claude-chat:${requestId}`,
    (event) => {
      const payload = event.payload;
      if (payload.kind === "line" && payload.data) {
        try {
          const parsed = JSON.parse(payload.data) as StreamJsonLine;
          // Every line carries the session id; the closing "result" line is
          // the only place the CLI says the turn actually finished cleanly.
          if (typeof parsed.session_id === "string") sessionId = parsed.session_id;
          if (parsed.type === "result") succeeded = parsed.is_error !== true;
          const text = extractDelta(parsed);
          if (text) queue.push(text);
        } catch {
          // Non-JSON or unrelated event line (e.g. system/init) — ignore.
        }
        wake?.();
      } else if (payload.kind === "done") {
        finished = true;
        wake?.();
      } else if (payload.kind === "error") {
        finished = true;
        failure = new ProviderError(payload.message ?? "The claude CLI reported an error.", CLI_HINT);
        wake?.();
      }
    },
  );

  try {
    const [cliPath, modelSetting] = await Promise.all([cliPathOverride(), getSetting("model")]);
    // Pin the model rather than inheriting the user's Claude Code default —
    // a deep-reasoning default (e.g. Fable/Opus with extended thinking) can
    // sit silent for 30-60s before the first visible token, which reads as
    // a dead chat. DESIGN.md §3.3: claude-sonnet-5 is the chat default.
    const model = modelSetting.trim() || "claude-sonnet-5";
    await invoke("claude_cli_chat", {
      requestId,
      systemPrompt: system,
      prompt,
      cliPath,
      model,
      resumeSessionId: resumable ? previous.id : null,
    });
  } catch (e) {
    unlisten();
    throw new ProviderError(typeof e === "string" ? e : "Could not start the claude CLI.", CLI_HINT);
  }

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (finished) {
        if (failure) throw failure;
        if (key && sessionId && succeeded) {
          cliSessions.set(key, {
            id: sessionId,
            sent: messages.length,
            signature: signature(messages, messages.length),
            system,
          });
        }
        break;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    unlisten();
    // If the consumer stopped early (user hit Stop / navigated away), kill
    // the CLI process instead of letting it run to completion unheard.
    // No-op when the process already finished.
    if (!finished) {
      invoke("claude_cli_cancel", { requestId }).catch(() => {});
    }
  }
}

/**
 * ClaudeSubscriptionProvider — spawns the `claude` CLI headlessly so chat
 * usage draws from the user's existing Pro/Max subscription rather than a
 * separately-billed API key. DESIGN.md §3.3.
 */
export function createClaudeSubscriptionProvider(): AIProvider {
  return {
    chatStream: stream,
    async complete(messages, system, options) {
      let full = "";
      for await (const chunk of stream(messages, system, options)) {
        full += chunk;
      }
      return full;
    },
  };
}
