import { beforeEach, describe, expect, it, vi } from "vitest";

// The hosted free-tier providers are plain OpenAI-compatible HTTP, so the
// only things worth testing are the parts Elytra adds: the bearer header, the
// SSE parse, and turning each failure status into a message a user can act on.

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

import { createCloudProvider, CLOUD_PRESETS, presetForBaseUrl } from "./cloud";
import { ProviderError } from "../types";

const CONFIG = {
  baseUrl: "https://api.groq.com/openai/v1/chat/completions",
  model: "qwen/qwen3.6-27b",
  apiKey: "gsk_test",
};

/** A response whose body streams the given OpenAI-style SSE lines. */
function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }),
        cancel: async () => {},
      }),
    },
  };
}

function errorResponse(status: number, message?: string) {
  return {
    ok: false,
    status,
    json: async () => (message ? { error: { message } } : {}),
  };
}

/** Runs a call that is expected to fail and hands back the ProviderError. */
async function failure(run: () => Promise<unknown>): Promise<ProviderError> {
  try {
    await run();
  } catch (e) {
    return e as ProviderError;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

async function collect(stream: AsyncIterable<string>) {
  let out = "";
  for await (const token of stream) out += token;
  return out;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("createCloudProvider", () => {
  it("refuses to build without an endpoint or a key", () => {
    expect(() => createCloudProvider({ ...CONFIG, baseUrl: "" })).toThrow(ProviderError);
    expect(() => createCloudProvider({ ...CONFIG, apiKey: "" })).toThrow(ProviderError);
  });

  it("sends the key as a bearer token and the model in the body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hi" } }] }) });

    const reply = await createCloudProvider(CONFIG).complete([{ role: "user", content: "hello" }], "be brief");

    expect(reply).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.baseUrl);
    expect(init.headers.authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(CONFIG.model);
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: "system", content: "be brief" });
  });

  it("streams the text deltas out of the SSE body", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\ndata: [DONE]\n',
      ]),
    );

    const text = await collect(createCloudProvider(CONFIG).chatStream([{ role: "user", content: "hi" }], "sys"));

    expect(text).toBe("Hello");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });

  it("explains a rejected key rather than the raw status", async () => {
    fetchMock.mockResolvedValue(errorResponse(401));
    await expect(
      createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys"),
    ).rejects.toThrow(/rejected the API key \(401\)/);
  });

  it("explains a free-tier rate limit and passes the provider's own detail on", async () => {
    fetchMock.mockResolvedValue(errorResponse(429, "Rate limit reached for model"));
    const err = await failure(() => createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys"));
    expect(err.message).toMatch(/free-tier limit/);
    expect(err.hint).toBe("Rate limit reached for model");
  });

  it("blames the model name on a bare 404", async () => {
    fetchMock.mockResolvedValue(errorResponse(404));
    const err = await failure(() => createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys"));
    expect(err.message).toMatch(/qwen\/qwen3\.6-27b/);
  });

  it("still blames the model name when the provider explains the 404 itself", async () => {
    // What a retired Groq model id actually returns — the detail is the useful
    // part, so it becomes the hint rather than being dropped.
    fetchMock.mockResolvedValue(errorResponse(404, "The model `x` does not exist or you do not have access to it."));
    const err = await failure(() => createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys"));
    expect(err.message).toMatch(/qwen\/qwen3\.6-27b/);
    expect(err.hint).toMatch(/does not exist/);
  });

  it("caps the reply with max_tokens, because free tiers refuse an oversized request", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(900); // the Groq preset's ceiling

    fetchMock.mockClear();
    await createCloudProvider({ ...CONFIG, maxTokens: 256 }).complete([{ role: "user", content: "hi" }], "sys");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(256);
  });

  it("asks a reasoning model to skip the scratchpad, per preset", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    await createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe("none");
  });

  it("strips a reasoning block the model sent anyway", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "<think>plan the opener</think>Hey Abhi." } }] }),
    });
    const reply = await createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys");
    expect(reply).toBe("Hey Abhi.");
  });

  it("separates a too-large request from a plain rate limit, though both are 429", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(429, "Request too large for model on output tokens per minute (OTPM): Limit 1000, Requested 1098"),
    );
    const err = await failure(() => createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys"));
    expect(err.message).toMatch(/too long a reply/);
    expect(err.hint).toMatch(/Longest reply/);
  });

  it("says the host is unreachable when the request never lands", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(
      createCloudProvider(CONFIG).complete([{ role: "user", content: "hi" }], "sys"),
    ).rejects.toThrow(/Could not reach the endpoint/);
  });
});

describe("CLOUD_PRESETS", () => {
  // Every preset host must also be in the Tauri http allowlist, so the list
  // stays small and each entry stays an https URL we control the shape of.
  it("are https chat-completions URLs, uniquely identified", () => {
    for (const preset of CLOUD_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https:\/\/[^/]+\/.*chat\/completions$/);
      expect(preset.model).not.toBe("");
      expect(preset.maxTokens).toBeGreaterThan(0);
      expect(presetForBaseUrl(preset.baseUrl)?.id).toBe(preset.id);
    }
    expect(new Set(CLOUD_PRESETS.map((p) => p.id)).size).toBe(CLOUD_PRESETS.length);
  });
});
