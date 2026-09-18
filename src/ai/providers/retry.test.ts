import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "./retry";

const response = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? "ok" : "busy", { status, headers });

function sequence(statuses: number[]) {
  let i = 0;
  const sent: number[] = [];
  return {
    sent,
    send: async () => {
      const status = statuses[Math.min(i++, statuses.length - 1)];
      sent.push(status);
      return response(status);
    },
  };
}

describe("fetchWithRetry", () => {
  it("sends once when the first answer is fine", async () => {
    const s = sequence([200]);
    const waits: number[] = [];
    const { res, attempts } = await fetchWithRetry(s.send, async (ms) => void waits.push(ms));
    expect(res.status).toBe(200);
    expect(attempts).toBe(1);
    expect(waits).toEqual([]);
  });

  it("rides out a busy provider and returns the good answer", async () => {
    const s = sequence([503, 503, 200]);
    const waits: number[] = [];
    const { res, attempts } = await fetchWithRetry(s.send, async (ms) => void waits.push(ms));
    expect(res.status).toBe(200);
    expect(attempts).toBe(3);
    expect(waits).toEqual([1500, 4000]);
  });

  it("gives up after three retries and hands back the last error", async () => {
    const s = sequence([503]);
    const { res, attempts } = await fetchWithRetry(s.send, async () => {});
    expect(res.status).toBe(503);
    expect(attempts).toBe(4);
  });

  it("never repeats a request that was simply wrong", async () => {
    for (const status of [400, 401, 404, 429]) {
      const s = sequence([status, 200]);
      const { res, attempts } = await fetchWithRetry(s.send, async () => {});
      expect(res.status).toBe(status);
      expect(attempts).toBe(1);
    }
  });

  it("waits as long as Retry-After asks, within reason", async () => {
    let first = true;
    const waits: number[] = [];
    await fetchWithRetry(
      async () => {
        if (!first) return response(200);
        first = false;
        return response(503, { "retry-after": "2" });
      },
      async (ms) => void waits.push(ms),
    );
    expect(waits).toEqual([2000]);
  });
});
