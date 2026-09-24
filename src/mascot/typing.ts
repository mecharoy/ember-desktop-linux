import { claim, release } from "./pulse";

/**
 * The beetle notices writing, the way the kit's states were meant to be used:
 * `listening` while keys are going, `thinking` when you stop mid-thought with
 * the field still open, and back to whatever else is happening once you leave
 * the field or have been still for a while. Any text field in the window
 * counts — the note sheet, the conversation, the entry page — so no component
 * has to wire it in.
 *
 * Only whether someone is typing is looked at, never what: the event's target
 * is checked for being a text field and nothing is read from it.
 *
 * This file is the same in elytra-desktop and elytra-mobile: change both.
 */

const PAUSE_MS = 1400; // stopped typing: listening → thinking
const DONE_MS = 9000; // still for this long: let the beetle go back to its day

let started = false;

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return ["text", "search", ""].includes(el.type);
  return el.isContentEditable;
}

export function startTypingWatch(): void {
  if (started) return;
  started = true;
  let pause: ReturnType<typeof setTimeout> | null = null;
  let done: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (pause) clearTimeout(pause);
    if (done) clearTimeout(done);
    pause = done = null;
  };

  document.addEventListener(
    "input",
    (e) => {
      if (!isTextField(e.target)) return;
      clear();
      claim("writing", "listening");
      pause = setTimeout(() => claim("writing", "thinking"), PAUSE_MS);
      done = setTimeout(() => release("writing"), DONE_MS);
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (e) => {
      if (!isTextField(e.target)) return;
      clear();
      release("writing");
    },
    true,
  );
}
