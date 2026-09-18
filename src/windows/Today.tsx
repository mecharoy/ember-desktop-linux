import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { deleteCapture, listUnjournaledCaptures } from "../db/captures";
import { localDateKey } from "../time";
import { groupCapturesByDay } from "../captureDays";
import { computeStreak } from "../db/entries";
import { dismissReminder, listPendingReminders } from "../db/reminders";
import type { Capture, Reminder } from "../db/types";
import CounselorChat from "../components/CounselorChat";
import ReminderBanner from "../components/ReminderBanner";

function formatTime(isoLocal: string): string {
  // created_at is already local wall-clock time (see db/captures.ts isoNow),
  // so a straight substring avoids any timezone re-interpretation.
  return isoLocal.slice(11, 16);
}

/** "Sun, Jul 12 · 10:00" — or just the time when it's due today. */
function formatDue(dueAt: string): string {
  const time = dueAt.slice(11, 16);
  if (dueAt.slice(0, 10) === localDateKey()) return `today · ${time}`;
  const day = new Date(`${dueAt.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day} · ${time}`;
}

/**
 * The day being journaled: today, or an earlier day opened from the Journal
 * calendar ("Talk it through"), in which case onBackToToday is set. On the
 * phone the day is three pages under one header: the day's notes, the
 * conversation, and the entry it becomes.
 */
export default function Today({
  date,
  active = true,
  onBackToToday,
  onQuickNote,
}: {
  date: string;
  active?: boolean;
  onBackToToday?: () => void;
  onQuickNote: () => void;
}) {
  const [captures, setCaptures] = useState<Capture[] | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  async function refresh() {
    // Not just this day's: a day that was never journaled keeps its notes here
    // until an entry covers them, so nothing quietly disappears at midnight.
    setCaptures(await listUnjournaledCaptures(date));
    setStreak(await computeStreak());
    setReminders(await listPendingReminders());
  }

  // The page stays mounted while hidden, so re-read on every return — saving
  // an entry, for one, journals notes without firing captures:updated.
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  useEffect(() => {
    const unlistenCaptures = listen("captures:updated", () => refresh());
    const unlistenReminders = listen("reminders:changed", () => refresh());
    return () => {
      unlistenCaptures.then((unlisten) => unlisten());
      unlistenReminders.then((unlisten) => unlisten());
    };
  }, []);

  async function handleDelete(id: number) {
    await deleteCapture(id);
    refresh();
  }

  async function handleDismissReminder(id: number) {
    await dismissReminder(id);
    refresh();
  }

  const isToday = date === localDateKey();
  const day = new Date(`${date}T12:00:00`);
  const weekday = day.toLocaleDateString(undefined, { weekday: "long" });
  const monthDay = day.toLocaleDateString(undefined, { month: "long", day: "numeric" });

  const notesPanel = (goTalk: () => void) => (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-5">
      {isToday && <ReminderBanner onTalk={goTalk} />}

      <button
        onClick={onQuickNote}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-dashed border-rule-strong bg-sheet/60 px-4 text-left transition-transform duration-150 active:scale-[0.98]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ember text-[20px] leading-none text-paper" aria-hidden="true">
          +
        </span>
        <span className="font-serif text-[17px] text-ink-soft">Jot something down&hellip;</span>
      </button>

      <section className="flex flex-col gap-1">
        <h2 className="font-serif text-[15px] italic text-ink-faint">Notes</h2>

        {captures === null && <p className="text-[14px] text-ink-faint">Loading&hellip;</p>}

        {captures !== null && captures.length === 0 && (
          <p className="text-[14px] leading-relaxed text-ink-soft">
            {isToday
              ? "Nothing jotted down yet. Drop a note whenever something happens. The conversation starts along with them."
              : "No notes are waiting from that day."}
          </p>
        )}

        {captures !== null && captures.length > 0 && (
          <div className="flex flex-col gap-4">
            {groupCapturesByDay(captures, date).map((d) => (
              <div key={d.dateKey} className="flex flex-col">
                {/* Only labelled once there is more than one day in view, so
                    the ordinary case stays a plain list. */}
                {!d.isToday && (
                  <h3 className="mb-0.5 mt-1 text-[12.5px] text-ink-faint">
                    {d.label} · <span className="italic">still unwritten</span>
                  </h3>
                )}
                <ul className="flex flex-col">
                  {d.captures.map((c, i) => (
                    <li
                      key={c.id}
                      className="ink-in flex items-baseline gap-3 border-b border-rule/70 py-2.5 last:border-b-0"
                      style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                    >
                      <span className="w-10 shrink-0 text-[12.5px] tabular-nums text-ink-faint">
                        {formatTime(c.created_at)}
                      </span>
                      <span
                        className={`selectable flex-1 font-serif text-[16.5px] leading-snug ${d.isToday ? "text-ink" : "text-ink-soft"}`}
                      >
                        {c.mood_emoji && <span className="mr-1.5 text-[14px]">{c.mood_emoji}</span>}
                        {c.text}
                      </span>
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center self-center text-[18px] leading-none text-ink-faint active:text-danger"
                        aria-label="Delete note"
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {isToday && reminders.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-serif text-[15px] italic text-ink-faint">Reminders</h2>
          <ul className="flex flex-col">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 border-b border-rule/70 py-2.5 last:border-b-0">
                <span className="flex-1 text-[15px] text-ink">{r.text}</span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">{formatDue(r.due_at)}</span>
                <button
                  onClick={() => handleDismissReminder(r.id)}
                  className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center self-center text-[18px] leading-none text-ink-faint active:text-ink"
                  aria-label="Dismiss reminder"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-end justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          {onBackToToday && (
            <button onClick={onBackToToday} className="btn-ghost -ml-3 mb-1 min-h-[34px] py-1">
              &larr; Back to today
            </button>
          )}
          <h1 className="page-title">{weekday}</h1>
          <p className="page-subtitle">
            {monthDay}
            {!isToday && " · looking back"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pb-0.5">
          {isToday && streak !== null && streak > 0 && (
            <p className="text-[13px] text-ink-soft">
              <span className="font-serif text-[19px] text-ember">{streak}</span> {streak === 1 ? "day" : "days"} in a row
            </p>
          )}
          <button onClick={onQuickNote} className="btn-subtle min-h-[36px] rounded-full px-3.5 py-1.5 text-[13.5px]">
            + Note
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <CounselorChat date={date} notes={notesPanel} notesCount={captures?.length ?? 0} />
      </div>
    </div>
  );
}
