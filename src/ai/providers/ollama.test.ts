import { describe, expect, it } from "vitest";

import { createOllamaProvider, linesFromEvents, type ChatEvent, type OllamaTransport } from "./ollama";
import { ProviderError } from "../types";

const line = (content: string, done = false, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ message: { role: "assistant", content }, done, ...extra });

/** A transport that records each body and answers from `reply`. */
function fake(reply: (body: Record<string, unknown>, call: number) => string[] | Error) {
  const bodies: Record<string, unknown>[] = [];
  const transport: OllamaTransport = async function* (body) {
    bodies.push(body);
    const out = reply(body, bodies.length);
    if (out instanceof Error) throw out;
    yield* out;
  };
  return { transport, bodies };
}

async function collect(it: AsyncIterable<string>) {
  let s = "";
  for await (const part of it) s += part;
  return s;
}

describe("ollama provider", () => {
  it("streams the reply with thinking off and the context size set", async () => {
    const { transport, bodies } = fake(() => [line("Hello "), line("there."), line("", true, { done_reason: "stop" })]);
    const provider = createOllamaProvider({ model: "qwen3.5:27b", numCtx: 16384, transport });
    const text = await collect(provider.chatStream([{ role: "user", content: "hi" }], "sys"));
    expect(text).toBe("Hello there.");
    expect(bodies[0]).toMatchObject({ model: "qwen3.5:27b", think: false, stream: true, options: { num_ctx: 16384 } });
    expect((bodies[0].messages as { role: string }[])[0]).toEqual({ role: "system", content: "sys" });
  });

  it("asks again without the think field when a model refuses it", async () => {
    const { transport, bodies } = fake((body) =>
      "think" in body
        ? new ProviderError("Ollama answered with an error (400).", '"m" does not support thinking')
        : [line("Fine."), line("", true)],
    );
    const provider = createOllamaProvider({ model: "m", transport });
    expect(await provider.complete([{ role: "user", content: "hi" }], "sys")).toBe("Fine.");
    expect(bodies).toHaveLength(2);
    expect("think" in bodies[1]).toBe(false);
  });

  it("doesn't retry other errors", async () => {
    const { transport, bodies } = fake(() => new ProviderError("Could not reach Ollama."));
    const provider = createOllamaProvider({ model: "m", transport });
    await expect(provider.complete([{ role: "user", content: "hi" }], "sys")).rejects.toThrow("Could not reach Ollama.");
    expect(bodies).toHaveLength(1);
  });

  it("says so when a reply ran out of room", async () => {
    const { transport } = fake(() => [line("Half a"), line("", true, { done_reason: "length" })]);
    const provider = createOllamaProvider({ model: "m", transport });
    await expect(provider.complete([{ role: "user", content: "hi" }], "sys")).rejects.toThrow("cut off");
  });

  it("hides reasoning a model writes into the reply itself", async () => {
    const { transport } = fake(() => [line("<think>plan</think>"), line("Answer"), line("", true)]);
    const provider = createOllamaProvider({ model: "m", transport });
    expect(await provider.complete([{ role: "user", content: "hi" }], "sys")).toBe("Answer");
  });

  it("turns streamed events into lines, and cancels when stopped early", async () => {
    let cancelled = 0;
    const events: ChatEvent[] = [{ kind: "status", status: 200, error: null }, { kind: "line", line: "a" }, { kind: "line", line: "b" }, { kind: "done" }];
    const make = () =>
      linesFromEvents({
        start: async (on) => events.forEach((e) => setTimeout(() => on(e), 0)),
        cancel: () => cancelled++,
        statusError: (s) => new ProviderError(`status ${s}`),
        failure: (m) => new ProviderError(m),
      });
    expect(await collect(make())).toBe("ab");
    expect(cancelled).toBe(0);
    for await (const _ of make()) break;
    expect(cancelled).toBe(1);
  });

  it("reports a refused request and a stopped background job", async () => {
    const refused = linesFromEvents({
      start: async (on) => on({ kind: "status", status: 403, error: "forbidden" }),
      cancel: () => {},
      statusError: (s, d) => new ProviderError(`status ${s}`, d ?? undefined),
      failure: (m) => new ProviderError(m),
    });
    await expect(collect(refused)).rejects.toThrow("status 403");

    const controller = new AbortController();
    const stopped = linesFromEvents({
      signal: controller.signal,
      start: async () => setTimeout(() => controller.abort(), 0),
      cancel: () => {},
      statusError: (s) => new ProviderError(`status ${s}`),
      failure: (m) => new ProviderError(m),
    });
    await expect(collect(stopped)).rejects.toThrow("make room");
  });
});
