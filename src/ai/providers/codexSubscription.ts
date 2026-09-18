import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSetting } from "../../db/settings";
import type { AIProvider, ChatMessage, ChatOptions } from "../types";
import { applyTurnPreamble, ProviderError } from "../types";

// The ChatGPT subscription through OpenAI's Codex CLI (src-tauri/src/codex_cli.rs).
// `codex exec` has no separate system prompt and no streaming of partial
// text, so the instructions travel at the top of the prompt and each reply
// arrives whole.

const CLI_HINT = "Make sure Codex is installed and signed in (Settings > AI provider).";

async function cliPathOverride(): Promise<string | undefined> {
  const path = await getSetting("codex_cli_path");
  return path.trim() || undefined;
}

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

export async function checkCodexCli(): Promise<Result<{ version: string; path: string }>> {
  try {
    const info = await invoke<{ version: string; path: string }>("codex_cli_version", { cliPath: await cliPathOverride() });
    return { ok: true, version: info.version, path: info.path };
  } catch (e) {
    return { ok: false, message: typeof e === "string" ? e : "Codex CLI not found." };
  }
}

export async function openCodexLogin(): Promise<Result<{ message: string }>> {
  try {
    return { ok: true, message: await invoke<string>("codex_open_login", { cliPath: await cliPathOverride() }) };
  } catch (e) {
    return { ok: false, message: typeof e === "string" ? e : "Could not open the sign-in window." };
  }
}

export async function installCodexCli(): Promise<Result<{ message: string }>> {
  try {
    return { ok: true, message: await invoke<string>("codex_install") };
  } catch (e) {
    return { ok: false, message: typeof e === "string" ? e : "Could not open the installer." };
  }
}

/** Instructions, then the conversation, in one plain-text prompt. */
export function buildCodexPrompt(messages: ChatMessage[], system: string): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return `<instructions>
${system}
</instructions>

You are not working on code here. Do not run commands, read files or use any
tools. Reply with the assistant's next message only, as plain text, following
the instructions above.

<conversation>
${transcript || "User: Begin."}
</conversation>`;
}

interface CodexLine {
  type?: string;
  message?: string;
  error?: { message?: string };
  item?: { type?: string; text?: string };
}

async function* stream(messages: ChatMessage[], system: string, options?: ChatOptions): AsyncIterable<string> {
  const requestId = crypto.randomUUID();
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: ProviderError | null = null;
  let messagesSeen = 0;

  const unlisten = await listen<{ kind: string; data?: string; message?: string }>(`codex-chat:${requestId}`, (event) => {
    const p = event.payload;
    if (p.kind === "line" && p.data) {
      try {
        const line = JSON.parse(p.data) as CodexLine;
        if (line.type === "item.completed" && line.item?.type === "agent_message" && line.item.text) {
          queue.push(messagesSeen++ > 0 ? `\n\n${line.item.text}` : line.item.text);
        } else if (line.type === "turn.failed") {
          failure = new ProviderError(line.error?.message ?? "Codex couldn't answer.", CLI_HINT);
        } else if (line.type === "error" && line.message && !/reconnecting/i.test(line.message)) {
          failure = new ProviderError(line.message, CLI_HINT);
        }
      } catch {
        // not an event line
      }
      wake?.();
    } else if (p.kind === "done") {
      finished = true;
      wake?.();
    } else if (p.kind === "error") {
      finished = true;
      failure ??= new ProviderError(p.message ?? "Codex reported an error.", CLI_HINT);
      wake?.();
    }
  });

  try {
    const [cliPath, model] = await Promise.all([cliPathOverride(), getSetting("model")]);
    await invoke("codex_cli_chat", {
      requestId,
      prompt: buildCodexPrompt(applyTurnPreamble(messages, options?.turnPreamble), system),
      cliPath,
      // Only an OpenAI model name; anything else leaves Codex on its default.
      model: /^(gpt|o\d|codex)/i.test(model.trim()) ? model.trim() : null,
    });
  } catch (e) {
    unlisten();
    throw new ProviderError(typeof e === "string" ? e : "Could not start Codex.", CLI_HINT);
  }

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (failure) throw failure;
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    unlisten();
    if (!finished) invoke("codex_cli_cancel", { requestId }).catch(() => {});
  }
}

export function createCodexSubscriptionProvider(): AIProvider {
  return {
    chatStream: stream,
    async complete(messages, system, options) {
      let full = "";
      for await (const chunk of stream(messages, system, options)) full += chunk;
      if (!full.trim()) throw new ProviderError("Codex returned an empty reply.", CLI_HINT);
      return full;
    },
  };
}
