import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { countCapturesForDate, createCapture } from "../db/captures";
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

/**
 * Quick note inside the main window: a sheet from the bottom in a narrow
 * window, a card in the middle of a wide one. (Ctrl+Shift+J opens the capture
 * bar from anywhere.) Save keeps the note; clicking outside or Escape keeps a
 * half-typed draft for next time. Ctrl+Enter saves.
 */
export default function QuickNote({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    countCapturesForDate(localDateKey()).then(setCount).catch(() => {});
    // After the rise animation starts, so the caret lands in the moving sheet.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createCapture(trimmed, mood);
      await emit("captures:updated");
      setText("");
      setMood(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center">
      <button aria-label="Close" onClick={onClose} className="fade-in absolute inset-0 bg-ink/25" />
      <div className="sheet-up relative rounded-t-2xl border-t border-rule bg-sheet px-5 pb-5 pt-3 shadow-[0_-8px_30px_-12px_rgba(40,35,30,0.35)] md:w-[560px] md:rounded-2xl md:border md:pt-5 md:shadow-[0_18px_50px_-18px_rgba(40,35,30,0.45)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule-strong md:hidden" aria-hidden="true" />
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-serif text-[19px] text-ink">A quick note</h2>
          <span className="text-[12.5px] tabular-nums text-ink-faint">
            {count} {count === 1 ? "note" : "notes"} today
          </span>
        </div>
        <textarea
          ref={inputRef}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="What's on your mind?"
          className="selectable block w-full resize-none bg-transparent font-serif text-[18px] leading-[1.5] text-ink outline-none placeholder:text-ink-faint/80 focus-visible:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Mood">
            {MOODS.map(({ emoji, label }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setMood((current) => (current === emoji ? null : emoji))}
                aria-pressed={mood === emoji}
                aria-label={label}
                title={label}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[20px] leading-none transition duration-150 active:scale-90 ${
                  mood === emoji ? "bg-paper-deep" : "opacity-45 grayscale"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button onClick={handleSave} disabled={!text.trim() || saving} className="btn-primary">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
