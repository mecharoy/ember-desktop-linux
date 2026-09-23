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
import DaySeam from "../components/DaySeam";
import { flash } from "../mascot/pulse";
import { getSetting, setSetting } from "../db/settings";

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
 * calendar ("Talk it through"), in which case onBackToToday is set.
 *
 * The day is ONE column, in the order the day happened: what you noted, then
 * the talk, then the entry it becomes. It used to be three sub-tabs called
 * Notes / Talk / Journal — with "Journal" also being a top-level tab meaning
 * something else — so reaching one day took two navigations and the same word
 * meant two things. The column is the fix.
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
    const run = await computeStreak();
    setStreak(run);
    // One hop per whole week reached, ever — not once per page view, and not
    // again every time the app is opened on the same day. Kept in settings
    // because the page remounts on every new day and on every launch.
    if (run > 0 && run % 7 === 0) {
      const cheered = Number(await getSetting("streak_cheered")) || 0;
      if (run > cheered) {
        await setSetting("streak_cheered", String(run));
        flash("celebrate");
      }
    }
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
  // The drawer label above the heading: "Thu 18 Sep 2026", in small capitals.
  const stamp = day
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .replace(/,/g, "");

  /** The top band of the day's column: what you noted as it happened. */
  const notesPanel = (goTalk: () => void) => (
    <div className="flex flex-col gap-6">
      {isToday && <ReminderBanner onTalk={goTalk} />}

      <section className="flex flex-col gap-2">
        <DaySeam
          label="Notes"
          trailing={
            <button onClick={onQuickNote} className="btn-chip gap-1.5" aria-label="Note something">
              <span aria-hidden="true" className="text-[14px] leading-none text-moss">
                +
              </span>
              Note
            </button>
          }
        />

        {captures === null && <p className="text-[14px] text-fg-faint">Loading&hellip;</p>}

        {captures !== null && captures.length === 0 && (
          <p className="punct-field rounded-lg px-4 py-5 text-[14px] leading-relaxed text-fg-dim">
            {isToday
              ? "Nothing yet. Note things as they happen — the evening conversation starts from them."
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
                  <h3 className="spec mb-1.5 mt-2">{d.label} &middot; still unwritten</h3>
                )}
                <ul className="flex flex-col">
                  {d.captures.map((c, i) => (
                    <li
                      key={c.id}
                      className="ink-in group flex items-baseline gap-3 py-1.5"
                      style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                    >
                      <span className="w-11 shrink-0 font-mono text-[11.5px] tabular-nums text-fg-faint">
                        {formatTime(c.created_at)}
                      </span>
                      <span
                        className={`selectable flex-1 text-[15.5px] leading-snug ${d.isToday ? "text-fg" : "text-fg-dim"}`}
                      >
                        {c.mood_emoji && <span className="mr-1.5 text-[14px]">{c.mood_emoji}</span>}
                        {c.text}
                      </span>
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center self-center text-[18px] leading-none text-fg-faint opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:text-danger"
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
        <section className="flex flex-col gap-2">
          <DaySeam label="Reminders" />
          <ul className="flex flex-col">
            {reminders.map((r) => (
              <li key={r.id} className="group flex items-baseline gap-3 py-1.5">
                <span className="flex-1 text-[15px] text-fg">{r.text}</span>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-fg-faint">{formatDue(r.due_at)}</span>
                <button
                  onClick={() => handleDismissReminder(r.id)}
                  className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center self-center text-[18px] leading-none text-fg-faint opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:text-fg"
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
      <header className="px-5 pb-3 pt-4">
        {/* The drawer rail: what day this is, and how long the run is. */}
        <div className="flex items-center justify-between gap-3">
          <span className="spec">{stamp}</span>
          {isToday && streak !== null && streak > 0 && (
            <span className="spec-strong">
              day {streak} &middot; streak
            </span>
          )}
          {!isToday && <span className="spec">looking back</span>}
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {onBackToToday && (
              <button onClick={onBackToToday} className="btn-ghost -ml-3 mb-1 min-h-[34px] py-1">
                &larr; Back to today
              </button>
            )}
            <h1 className="page-title">{weekday}</h1>
          </div>
          {/* Nothing sits on the right any more. The beetle and the note
              button both moved into the dock, which carries them on every
              page and on both platforms — one mascot, one place. */}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <CounselorChat date={date} notes={notesPanel} />
      </div>
    </div>
  );
}
