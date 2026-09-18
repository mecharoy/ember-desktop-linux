import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const { replyCeiling } = await import("./openaiCompatible");
const { estimateTokens } = await import("../tokens");

describe("replyCeiling", () => {
  it("keeps the usual ceiling for a chat turn", () => {
    expect(replyCeiling({ maxTokens: 900, jobMaxTokens: 3000 })).toBe(900);
  });

  it("gives a job what it asks for, up to the job ceiling", () => {
    expect(replyCeiling({ maxTokens: 900, jobMaxTokens: 3000 }, 2500)).toBe(2500);
    expect(replyCeiling({ maxTokens: 900, jobMaxTokens: 3000 }, 5000)).toBe(3000);
  });

  it("leaves room for the prompt in a tokens-per-minute allowance", () => {
    expect(replyCeiling({ maxTokens: 900, jobMaxTokens: 3000, tokensPerMinute: 8000 }, 3000, 6500)).toBe(1500);
  });

  it("with no job ceiling, a job gets what it asks for", () => {
    expect(replyCeiling({ maxTokens: 900 }, 3000)).toBe(3000);
  });
});

describe("estimateTokens", () => {
  it("errs on the big side of the ~4 characters a token measured", () => {
    expect(estimateTokens("x".repeat(4000))).toBeGreaterThanOrEqual(1000);
  });
});
