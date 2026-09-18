/** Statuses that mean "the provider is busy right now", not "your request is
 *  wrong": worth sending the same request again after a pause. 429 is left
 *  out on purpose — on free tiers it is usually a quota that a few seconds
 *  won't refill, and it has its own message. 529 is Anthropic's "overloaded". */
export const TRANSIENT_STATUSES = new Set([500, 502, 503, 504, 529]);

/** Waits before retries 1, 2 and 3. Google's own guidance for 503 is
 *  exponential backoff; three tries covers a short capacity dip without
 *  leaving someone staring at the thinking dot for long. */
export const RETRY_DELAYS_MS = [1500, 4000, 9000];

/** A Retry-After header (seconds), if the provider sent a usable one. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 20 ? seconds * 1000 : null;
}

/**
 * Sends a request, and sends it again while the provider answers with a
 * transient error. Returns the last response either way; the caller turns a
 * failed one into a readable error. Only the request is repeated, before any
 * reply text has arrived, so nothing is shown twice.
 */
export async function fetchWithRetry(
  send: () => Promise<Response>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ res: Response; attempts: number }> {
  let res = await send();
  let attempts = 1;
  for (const delay of RETRY_DELAYS_MS) {
    if (res.ok || !TRANSIENT_STATUSES.has(res.status)) break;
    // Drain the error body so the connection can be reused.
    await res.text().catch(() => "");
    await sleep(retryAfterMs(res) ?? delay);
    res = await send();
    attempts++;
  }
  return { res, attempts };
}
