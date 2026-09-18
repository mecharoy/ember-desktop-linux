// Sharing one local model between the conversation and background jobs.
//
// Ollama usually answers one request at a time, so a weekly review writing on
// the model makes the evening's first reply wait minutes behind it. Measured
// on a 27B model: three reviews queued at launch held the opening line back
// by over three minutes. So with the local model, background jobs don't start
// while a conversation is going, and a conversation starting (here or from
// the phone) stops a job already running. A stopped job runs again later:
// each one only writes what is still due.

let running: { controller: AbortController; done: Promise<unknown> } | null = null;
let lastConversation = 0;
const launchedAt = Date.now();

/** How long after the last message background jobs keep waiting. */
const QUIET_MS = 15 * 60 * 1000;
/** Jobs wait this long after Ember opens, when a conversation often starts. */
const LAUNCH_GRACE_MS = 3 * 60 * 1000;

/** The signal a request made now should stop on, if it belongs to a job. */
export function backgroundSignal(): AbortSignal | undefined {
  return running?.controller.signal;
}

export function noteConversation(): void {
  lastConversation = Date.now();
}

/** True when a job would get in a conversation's way. */
export function conversationLikely(): boolean {
  const now = Date.now();
  return now - lastConversation < QUIET_MS || now - launchedAt < LAUNCH_GRACE_MS;
}

export function backgroundBusy(): boolean {
  return running !== null;
}

/** Stops a running background job and waits for it to let go of the model. */
export async function makeRoomForConversation(): Promise<void> {
  noteConversation();
  const job = running;
  if (!job) return;
  job.controller.abort();
  await job.done.catch(() => {});
}

/** Runs `fn` as a background job that a conversation may stop. */
export function runInBackground<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let finish!: () => void;
  // Registered before fn starts, so every request fn makes sees the signal.
  const job = { controller, done: new Promise<void>((resolve) => (finish = resolve)) };
  running = job;
  return Promise.resolve()
    .then(() => fn(controller.signal))
    .finally(() => {
      if (running === job) running = null;
      finish();
    });
}
