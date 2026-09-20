import { beforeEach, describe, expect, it, vi } from "vitest";

// Short jobs (the checklist asks for 600–700 tokens) must go through on a
// free tier. Only a reply squeezed below what the job wanted is refused.

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

import { createOpenAiCompatibleProvider } from "./openaiCompatible";

const CONFIG = {
  baseUrl: "https://api.groq.com/openai/v1/chat/completions",
  model: "m",
  apiKey: "k",
  maxTokens: 900,
  jobMaxTokens: 3000,
  tokensPerMinute: 8000,
  kind: "cloud" as const,
};

const ok = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }) };

describe("job reply room", () => {
  beforeEach(() => fetchMock.mockReset());

  it("sends a short job as asked", async () => {
    fetchMock.mockResolvedValue(ok);
    const p = createOpenAiCompatibleProvider(CONFIG);
    await expect(p.complete([{ role: "user", content: "hi" }], "sys", { maxTokens: 600 })).resolves.toBe("{}");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(600);
  });

  it("still refuses a job the per-minute allowance squeezes below its need", async () => {
    const p = createOpenAiCompatibleProvider(CONFIG);
    const big = "x".repeat(4 * 7500);
    await expect(p.complete([{ role: "user", content: big }], "sys", { maxTokens: 2400 })).rejects.toThrow(/too much for the free tier/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
