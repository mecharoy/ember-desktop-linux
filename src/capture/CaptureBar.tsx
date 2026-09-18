import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { createCapture, countCapturesForDate } from "../db/captures";
import { localDateKey } from "../time";

const MOODS = [
  { emoji: "😞", label: "down" },
  { emoji: "😕", label: "uneasy" },
  { emoji: "😐", label: "neutral" },
  { emoji: "🙂", label: "good" },
  { emoji: "😄", label: "great" },
  { emoji: "😠", label: "angry" },
  { emoji: "😵‍💫", label: "confused" },
  { emoji: "😴", label: "sleepy" },
];
const FADE_MS = 150;
const BAR_WIDTH = 560;
const VERTICAL_PADDING = 24; // py-3 top + bottom
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 220; // ~6 lines before the textarea scrolls instead of growing further
const MIN_TEXTAREA_HEIGHT = MIN_HEIGHT - VERTICAL_PADDING;
const MAX_TEXTAREA_HEIGHT = MAX_HEIGHT - VERTICAL_PADDING;

export default function CaptureBar() {
  const [text, setText] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function refreshCount() {
    setCount(await countCapturesForDate(localDateKey()));
  }

  // Grows the (non-resizable-by-drag) window to fit the textarea's content,
  // capped at MAX_HEIGHT — a capture can now run to a few lines without
  // clipping, but doesn't take over the screen. Clearing the text (on
  // submit or Esc) shrinks it straight back to MIN_HEIGHT.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const textareaHeight = Math.min(Math.max(el.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
    el.style.height = `${textareaHeight}px`;
    getCurrentWindow().setSize(new LogicalSize(BAR_WIDTH, textareaHeight + VERTICAL_PADDING));
  }, [text]);

  useEffect(() => {
    refreshCount();
    inputRef.current?.focus();

    // Rust re-shows this window rather than recreating it, so it re-emits
    // this event each time the hotkey/tray toggles the bar open — that's our
    // cue to refocus, since the webview itself never remounts. A half-typed
    // draft survives a click-away on purpose: only Enter (saved) or Esc
    // (deliberate dismissal) clears it.
    const unlistenPromise = listen("capture-bar:focus", () => {
      setVisible(true);
      refreshCount();
      requestAnimationFrame(() => inputRef.current?.focus());
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function hideWithFade() {
    setVisible(false);
    await new Promise((resolve) => setTimeout(resolve, FADE_MS));
    await getCurrentWindow().hide();
  }

  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setText("");
      setMood(null);
      await hideWithFade();
      return;
    }
    // Plain Enter submits (keeps the "type, Enter, back to work" flow);
    // Shift+Enter inserts a newline for the rare thought that runs long.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        await hideWithFade();
        return;
      }
      await createCapture(trimmed, mood);
      await emit("captures:updated");
      setText("");
      setMood(null);
      await hideWithFade();
    }
  }

  return (
    <div
      className={`flex w-full items-start gap-3 rounded-[14px] border border-rule bg-sheet px-4 py-3 shadow-[0_1px_6px_rgba(40,35,30,0.14)] transition-[opacity,transform] ease-settle ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What's on your mind?"
        className="flex-1 resize-none overflow-y-auto bg-transparent font-serif text-[16px] leading-[1.5] text-ink placeholder:text-ink-faint/80 outline-none"
      />
      {/* Grey until picked, so the row of faces stays quiet on the paper. */}
      <div className="flex items-center gap-0.5 pt-0.5">
        {MOODS.map(({ emoji, label }) => (
          <button
            key={emoji}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => setMood((current) => (current === emoji ? null : emoji))}
            aria-pressed={mood === emoji}
            className={`rounded-md px-1 py-0.5 text-[15px] leading-none transition duration-200 ${
              mood === emoji ? "bg-paper-deep" : "opacity-45 grayscale hover:opacity-100 hover:grayscale-0"
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <span className="whitespace-nowrap pt-1 text-[11.5px] tabular-nums text-ink-faint">
        {count} {count === 1 ? "note" : "notes"} today
      </span>
    </div>
  );
}
