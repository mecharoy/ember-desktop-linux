import { useEffect, useState } from "react";
import type { MascotState } from "./mascot";

/**
 * One beetle, many callers.
 *
 * The mascot is mounted in a single anchored spot per window. Anything that
 * takes time — a reply arriving, a sync, a save — claims a state here and
 * releases it when it's done; the beetle shows whichever live claim ranks
 * highest. Nothing else in the app touches the mascot directly, so it can
 * never end up in two states at once or stuck spinning after a failure.
 *
 * `flash` is for the two states that are events, not conditions: the save
 * snap and a celebration. They play once over whatever is showing.
 */

/** Low to high. A thinking model outranks a sync; both outrank typing. */
const RANK: MascotState[] = ["sleeping", "idle", "listening", "flying", "loading", "thinking"];

const claims = new Map<string, MascotState>();
const listeners = new Set<(s: MascotState) => void>();
let flashed: { state: MascotState; at: number } | null = null;
let asleep = false;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

/** Nothing has happened for this long: the beetle folds up and dozes. */
const SLEEP_AFTER = 90_000;

function resolved(): MascotState {
  if (claims.size === 0) return asleep ? "sleeping" : "idle";
  let best: MascotState = "idle";
  for (const s of claims.values()) {
    if (RANK.indexOf(s) > RANK.indexOf(best)) best = s;
  }
  return best;
}

function announce() {
  const s = resolved();
  for (const fn of listeners) fn(s);
}

function stirred() {
  asleep = false;
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    asleep = true;
    if (claims.size === 0) announce();
  }, SLEEP_AFTER);
}

/** Hold a state until `release(id)`. Calling it again with the same id moves
 *  that claim rather than adding a second one. */
export function claim(id: string, state: MascotState): void {
  stirred();
  if (claims.get(id) === state) return;
  claims.set(id, state);
  announce();
}

export function release(id: string): void {
  if (!claims.delete(id)) return;
  stirred();
  announce();
}

/** Someone is here. Reading a page claims nothing, so without this the beetle
 *  would doze off while a person sits looking straight at it. */
export function wake(): void {
  const was = asleep;
  stirred();
  if (was) announce();
}

/** Play one cycle of a state over whatever is showing: `saving`, `celebrate`. */
export function flash(state: MascotState): void {
  stirred();
  flashed = { state, at: Date.now() };
  for (const fn of flashListeners) fn(state);
}

const flashListeners = new Set<(s: MascotState) => void>();

export function subscribe(fn: (s: MascotState) => void): () => void {
  listeners.add(fn);
  fn(resolved());
  return () => listeners.delete(fn);
}

export function subscribeFlash(fn: (s: MascotState) => void): () => void {
  flashListeners.add(fn);
  // A flash from the last half-second still counts: the beetle may have
  // mounted a moment after the thing it is reacting to.
  if (flashed && Date.now() - flashed.at < 500) fn(flashed.state);
  return () => flashListeners.delete(fn);
}

/** The state the anchored beetle should be in right now. */
export function useMascotState(): MascotState {
  const [state, setState] = useState<MascotState>("idle");
  useEffect(() => subscribe(setState), []);
  return state;
}

/** Claim a state for as long as `on` is true. Releases on unmount. */
export function useMascotClaim(id: string, state: MascotState, on: boolean): void {
  useEffect(() => {
    if (on) claim(id, state);
    else release(id);
  }, [id, state, on]);
  useEffect(() => () => release(id), [id]);
}

/** Only used by tests and by the beetle itself. */
export function reset(): void {
  claims.clear();
  flashed = null;
  asleep = false;
  if (sleepTimer) clearTimeout(sleepTimer);
  announce();
}

let typingTimer: ReturnType<typeof setTimeout> | null = null;

/** Someone is typing. Holds `listening` for a moment and lets go on its own,
 *  so callers don't have to manage a keystroke timer each. */
export function typing(): void {
  claim("typing", "listening");
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => release("typing"), 1600);
}
