import { beforeEach, describe, expect, it, vi } from "vitest";

// The CLI provider talks to Rust through invoke/listen, so both are faked
// here: `listen` hands us the event callback and `invoke` plays a scripted
// run of the CLI back through it. What is actually under test is the session
// bookkeeping — when a turn is allowed to resume, and what it sends when it
// does — because that is what decides whether a turn is a prompt-cache read
// or a full re-write.

let handler: ((e: { payload: Record<string, unknown> }) => void) | null = null;
const invokeCalls: { cmd: string; args: Record<string, unknown> }[] = [];

/** What the CLI streams back on a turn that finishes cleanly. */
function scriptSuccess(sessionId: string, text: string) {
  handler?.({
    payload: {
      kind: "line",
      data: JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }),
    },
  });
  handler?.({
    payload: {
      kind: "line",
      data: JSON.stringify({
        type: "stream_event",
        session_id: sessionId,
        event: { type: "content_block_delta", delta: { type: "text_delta", text } },
      }),
    },
  });
  handler?.({
    payload: {
      kind: "line",
      data: JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sessionId }),
    },
  });
  handler?.({ payload: { kind: "done" } });
}

/** A turn the CLI fails partway through — nothing may be resumed after it. */
function scriptFailure() {
  handler?.({ payload: { kind: "error", message: "claude exited with code 1" } });
}

let script: () => void = () => {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: Record<string, unknown> }) => void) => {
    handler = cb;
    return () => {
      handler = null;
    };
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    invokeCalls.push({ cmd, args });
    if (cmd === "claude_cli_chat") script();
    return undefined;
  }),
}));

vi.mock("../../db/settings", () => ({
  getSetting: vi.fn(async (key: string) => (key === "model" ? "claude-sonnet-5" : "")),
}));

const { createClaudeSubscriptionProvider, forgetCliSession } = await import("./claudeSubscription");

const SYSTEM = "You are Elytra.";
const CONVO = { conversationId: "7" };

async function drain(iterable: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of iterable) out += chunk;
  return out;
}

/** One completed turn: run it, and report what reached the CLI. */
async function turn(
  messages: { role: "user" | "assistant"; content: string }[],
  opts: {
    system?: string;
    conversationId?: string;
    sessionId?: string;
    fail?: boolean;
    preamble?: string;
  } = {},
) {
  const provider = createClaudeSubscriptionProvider();
  script = opts.fail ? scriptFailure : () => scriptSuccess(opts.sessionId ?? "sess-a", "ok");
  const options = {
    conversationId: opts.conversationId === undefined ? CONVO.conversationId : opts.conversationId,
    turnPreamble: opts.preamble,
  };
  const run = provider.chatStream(messages, opts.system ?? SYSTEM, options);
  let error: unknown = null;
  try {
    await drain(run);
  } catch (e) {
    error = e;
  }
  const call = invokeCalls[invokeCalls.length - 1];
  return { error, prompt: call?.args.prompt as string, resume: call?.args.resumeSessionId as string | null };
}

const U1 = { role: "user" as const, content: "Let's begin tonight's check-in." };
const A1 = { role: "assistant" as const, content: "What stood out today?" };
const U2 = { role: "user" as const, content: "The vendor call went badly." };
const A2 = { role: "assistant" as const, content: "What made it bad?" };
const U3 = { role: "user" as const, content: "He talked over me." };

describe("claudeSubscription session reuse", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    handler = null;
    forgetCliSession(CONVO.conversationId);
  });

  it("starts a fresh session on the first turn", async () => {
    const t = await turn([U1]);
    expect(t.resume).toBeNull();
    expect(t.prompt).toBe(U1.content);
  });

  it("resumes on the next turn and sends only the new message", async () => {
    await turn([U1]);
    const t = await turn([U1, A1, U2]);
    expect(t.resume).toBe("sess-a");
    expect(t.prompt).toBe(U2.content);
    // The whole point: the earlier exchange is never re-sent.
    expect(t.prompt).not.toContain(A1.content);
  });

  it("keeps resuming as the conversation grows", async () => {
    await turn([U1]);
    await turn([U1, A1, U2]);
    const t = await turn([U1, A1, U2, A2, U3]);
    expect(t.resume).toBe("sess-a");
    expect(t.prompt).toBe(U3.content);
  });

  it("adds the turn preamble to what it sends, not to what it remembers", async () => {
    // The preamble changes every turn by design. It has to reach the model,
    // and it must not disturb the fingerprint, or no turn would ever resume.
    await turn([U1], { preamble: "[SESSION STATE — 21:15]" });
    const t = await turn([U1, A1, U2], { preamble: "[SESSION STATE — 21:22]" });
    expect(t.prompt).toBe(`[SESSION STATE — 21:22]\n\n${U2.content}`);
    expect(t.resume).toBe("sess-a");
  });

  it("starts fresh when the system prompt changed", async () => {
    await turn([U1]);
    const t = await turn([U1, A1, U2], { system: "You are someone else." });
    expect(t.resume).toBeNull();
    expect(t.prompt).toContain(A1.content);
  });

  it("starts fresh when earlier history was rewritten", async () => {
    await turn([U1]);
    const t = await turn([{ ...U1, content: "something else entirely" }, A1, U2]);
    expect(t.resume).toBeNull();
  });

  it("forgets the session after a failed turn, so a retry replays in full", async () => {
    await turn([U1]);
    const failed = await turn([U1, A1, U2], { fail: true });
    expect(failed.error).toBeTruthy();
    const retry = await turn([U1, A1, U2]);
    expect(retry.resume).toBeNull();
    expect(retry.prompt).toContain(A1.content);
  });

  it("never resumes without a conversation id", async () => {
    await turn([U1], { conversationId: "" });
    const t = await turn([U1, A1, U2], { conversationId: "" });
    expect(t.resume).toBeNull();
    expect(t.prompt).toContain(A1.content);
  });

  it("keeps separate conversations apart", async () => {
    await turn([U1], { sessionId: "sess-a" });
    await turn([U1], { conversationId: "9", sessionId: "sess-b" });
    const t = await turn([U1, A1, U2]);
    expect(t.resume).toBe("sess-a");
    forgetCliSession("9");
  });
});
