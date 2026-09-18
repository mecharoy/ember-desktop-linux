import { useEffect, useMemo, useRef, useState } from "react";
import { deleteEntry, listEntries, moveEntry, saveEntry, setEntryPaper } from "../db/entries";
import { listCapturesForDate } from "../db/captures";
import { localDateKey } from "../time";
import {
  getOrCreateTodaySession,
  linkCapturesToSession,
  listUnwrittenConversationDays,
  wrapSession,
} from "../db/sessions";
import { rebuildObservations } from "../db/observations";
import { deleteReviewsWithoutDays } from "../db/reviews";
import { getSetting } from "../db/settings";
import { runReviewJobsAndNotify } from "../ai/reviewJobs";
import { runDayExtraction } from "../ai/extractor";
import type { Capture, Entry } from "../db/types";
import type { JournalFocus } from "./navigation";
import EntryFields, { type EntryDraft } from "../components/EntryFields";
import { DEFAULT_PAPER, paperById, paperStyle } from "../components/paper";
import { useBackButton } from "../useBackButton";

function toDraft(e: Entry): EntryDraft {
  return {
    title: e.title,
    narrative: e.narrative,
    highlights: JSON.parse(e.highlights || "[]"),
    counselorNote: e.counselor_note,
  };
}

const BLANK: EntryDraft = { title: "", narrative: "", highlights: [], counselorNote: "" };

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function weekdayOf(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
}

function shortDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Notes jotted on a day, shown beside a page being written for it. */
function DayNotes({ notes }: { notes: Capture[] }) {
  return (
    <section className="flex flex-col gap-1 border-t border-rule pt-4">
      <h2 className="font-serif text-[15px] italic text-ink-faint">Notes from that day</h2>
      <ul className="flex flex-col">
        {notes.map((c) => (
          <li key={c.id} className="flex items-baseline gap-3 py-1.5">
            <span className="w-10 shrink-0 text-[12.5px] tabular-nums text-ink-faint">{c.created_at.slice(11, 16)}</span>
            <span className="selectable font-serif text-[16px] leading-snug text-ink">
              {c.mood_emoji && <span className="mr-1.5 text-[14px]">{c.mood_emoji}</span>}
              {c.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One entry in the list: a strip of its page, in its own paper and hand. */
function PageCard({ entry, fallbackPaper, index, onOpen }: { entry: Entry; fallbackPaper: string; index: number; onOpen: () => void }) {
  const paperId = paperById(entry.paper ?? fallbackPaper).id;
  const tilt = [-0.7, 0.5, -0.3, 0.8][index % 4];
  const firstLine = entry.narrative.split(/\n/)[0] ?? "";
  return (
    <button
      onClick={onOpen}
      className="paper-sheet block w-full text-left"
      style={{ ...paperStyle(paperId), transform: `rotate(${tilt}deg)`, paddingTop: 0, paddingBottom: 0, paddingLeft: 52 }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="hand min-w-0 flex-1 truncate" style={{ fontSize: 26, fontWeight: 650 }}>
          {entry.title || "Untitled"}
        </span>
        <span className="hand shrink-0" style={{ fontSize: 18, color: "var(--paper-soft)" }}>
          {shortDate(entry.date)}
        </span>
      </div>
      <p className="hand truncate" style={{ fontSize: 20, color: "var(--paper-soft)" }}>
        {firstLine || " "}
      </p>
    </button>
  );
}

export default function Journal({
  active = true,
  focus = null,
  onClearFocus,
  onDaysChanged,
  onTalkAbout,
}: {
  /** The page stays mounted between visits; hidden, it keeps quiet. */
  active?: boolean;
  focus?: JournalFocus | null;
  onClearFocus?: () => void;
  /** Called with the dates an entry was deleted from, moved between, or written for. */
  onDaysChanged?: (dates: string[]) => void;
  /** "Talk it through" for a day with no entry: open its conversation on Today. */
  onTalkAbout?: (date: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [paper, setPaper] = useState<string | null>(null);
  const [defaultPaper, setDefaultPaper] = useState(DEFAULT_PAPER);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // "Write it myself": a blank page for a day that has no entry yet.
  const [writing, setWriting] = useState(false);
  const [dayNotes, setDayNotes] = useState<Capture[] | null>(null);
  // Days with a conversation but no entry, so they don't pass for empty days.
  const [unwritten, setUnwritten] = useState<{ date: string; messages: number }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const notesFor = useRef<string | null>(null);
  const today = localDateKey();

  async function refresh() {
    const [list, talked] = await Promise.all([listEntries(), listUnwrittenConversationDays()]);
    setEntries(list);
    setUnwritten(talked);
  }

  useEffect(() => {
    if (!active) return;
    refresh();
    getSetting("journal_paper")
      .then((v) => setDefaultPaper(paperById(v).id))
      .catch(() => {});
  }, [active]);

  // Back closes an open page and returns to the list.
  useBackButton(active && selectedDate !== null, () => closeDay());

  const entryByDate = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of entries) map.set(e.date, e);
    return map;
  }, [entries]);

  const unwrittenDays = useMemo(() => new Set(unwritten.map((u) => u.date)), [unwritten]);

  // Insights click-through filter (everything links back
  // to entries). A single-date focus opens that entry directly.
  const visibleEntries = useMemo(
    () => (focus ? entries.filter((e) => focus.dates.includes(e.date)) : entries),
    [entries, focus],
  );

  // Once per focus: later refreshes (a save, a paper change) must not reload
  // the page over edits still being made.
  const openedFocus = useRef<JournalFocus | null>(null);
  useEffect(() => {
    if (!focus || entries.length === 0 || openedFocus.current === focus) return;
    openedFocus.current = focus;
    if (focus.dates.length !== 1) return;
    const only = focus.dates[0];
    const entry = entryByDate.get(only);
    if (entry) {
      setSelectedDate(only);
      setDraft(toDraft(entry));
      setPaper(entry.paper);
      setSavedAt(null);
      setWriting(false);
      resetActions();
    }
  }, [focus, entries]);

  function loadNotes(dateKey: string) {
    notesFor.current = dateKey;
    setDayNotes(null);
    listCapturesForDate(dateKey).then((notes) => {
      if (notesFor.current === dateKey) setDayNotes(notes);
    });
  }

  function selectDate(dateKey: string) {
    if (dateKey > today) return;
    const entry = entryByDate.get(dateKey);
    setSelectedDate(dateKey);
    setSavedAt(null);
    setWriting(false);
    resetActions();
    if (entry) {
      setDraft(toDraft(entry));
      setPaper(entry.paper);
      notesFor.current = null;
      setDayNotes(null);
      return;
    }
    setDraft(null);
    setPaper(null);
    loadNotes(dateKey);
  }

  function closeDay() {
    setSelectedDate(null);
    setDraft(null);
    setWriting(false);
    resetActions();
  }

  function resetActions() {
    setConfirmDelete(false);
    setShowMove(false);
    setMoveTo("");
    setActionError(null);
  }

  function startWriting() {
    setDraft({ ...BLANK });
    setWriting(true);
    setSavedAt(null);
    setActionError(null);
  }

  function cancelWriting() {
    setDraft(null);
    setWriting(false);
    setActionError(null);
  }

  async function handlePaper(id: string) {
    setPaper(id);
    if (selectedDate && entryByDate.has(selectedDate)) {
      await setEntryPaper(selectedDate, id).catch(() => {});
      refresh();
    }
  }

  async function handleSave() {
    if (!selectedDate || !draft) return;
    const entry = entryByDate.get(selectedDate);
    if (!entry) {
      await handleSaveNew(selectedDate, draft);
      return;
    }
    await saveEntry({
      sessionId: entry.session_id,
      date: entry.date,
      title: draft.title,
      narrative: draft.narrative,
      highlights: draft.highlights,
      counselorNote: draft.counselorNote,
      userEdited: true,
    });
    setSavedAt(Date.now());
    refresh();
  }

  /** The first save of a page written by hand. An entry needs a session, and
   * that session takes over the notes still waiting up to that day, the same
   * as one written from a conversation would. */
  async function handleSaveNew(date: string, page: EntryDraft) {
    const saved = { ...page, title: page.title.trim() || weekdayOf(date) };
    try {
      const session = await getOrCreateTodaySession(date);
      await linkCapturesToSession(session.id, date);
      await saveEntry({
        sessionId: session.id,
        date,
        title: saved.title,
        narrative: saved.narrative,
        highlights: saved.highlights,
        counselorNote: saved.counselorNote,
        userEdited: true,
      });
      if (paper) await setEntryPaper(date, paper);
      await wrapSession(session.id);
    } catch {
      setActionError("Couldn't save the entry. Try again.");
      return;
    }
    setDraft(saved);
    setWriting(false);
    setSavedAt(Date.now());
    await refresh();
    onDaysChanged?.([date]);
    // Read for Insights in the background, as an entry from a conversation is.
    void runDayExtraction({
      date,
      entry: { title: saved.title, narrative: saved.narrative, highlights: saved.highlights, counselorNote: saved.counselorNote },
      transcript: [],
    }).catch(() => {});
  }

  /** Insights is built from the extracted days, so it follows any change to
   * which days exist. Review letters are rewritten in the background. */
  async function syncDerived(dates: string[]) {
    onDaysChanged?.(dates);
    try {
      await rebuildObservations();
      await deleteReviewsWithoutDays();
    } catch {
      // Derived data only; the next extraction rebuilds it.
    }
    void runReviewJobsAndNotify({ whenIdle: true }).catch(() => {});
  }

  async function handleDelete() {
    if (!selectedDate) return;
    const date = selectedDate;
    try {
      await deleteEntry(date);
    } catch {
      setActionError("Couldn't delete the entry. Nothing was changed.");
      return;
    }
    // The day stays selected and now offers to be written again.
    setDraft(null);
    setSavedAt(null);
    resetActions();
    loadNotes(date);
    await refresh();
    await syncDerived([date]);
  }

  async function handleMove() {
    if (!selectedDate) return;
    const from = selectedDate;
    const to = moveTo;
    let result;
    try {
      result = await moveEntry(from, to);
    } catch {
      setActionError("Couldn't move the entry.");
      return;
    }
    if (!result.ok) {
      setActionError(result.reason);
      return;
    }
    await refresh();
    // The draft is kept as is, so unsaved edits go along with the entry.
    setSelectedDate(to);
    setMonthCursor({ year: Number(to.slice(0, 4)), month: Number(to.slice(5, 7)) - 1 });
    resetActions();
    await syncDerived([from, to]);
  }

  function shiftMonth(delta: number) {
    setMonthCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const daysInMonth = new Date(monthCursor.year, monthCursor.month + 1, 0).getDate();
  const firstWeekday = new Date(monthCursor.year, monthCursor.month, 1).getDay();
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${monthCursor.year}-${String(monthCursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  const monthLabel = new Date(monthCursor.year, monthCursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const hasEntry = selectedDate !== null && entryByDate.has(selectedDate);

  // ---------- one day, full screen ----------
  if (selectedDate !== null) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-rule px-2 py-1.5">
          <button onClick={closeDay} className="btn-ghost text-ink-soft" aria-label="Back to the journal">
            &larr; Journal
          </button>
          <span className="ml-auto pr-3 text-[13px] text-ink-faint">{shortDate(selectedDate)}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-5">
          {draft ? (
            <div key={`${selectedDate}:${writing}`} className="fade-up flex flex-col gap-6">
              {writing && dayNotes && dayNotes.length > 0 && <DayNotes notes={dayNotes} />}
              <EntryFields
                date={selectedDate}
                draft={draft}
                onChange={setDraft}
                paper={paper}
                onPaperChange={handlePaper}
                onSave={handleSave}
                saveLabel={hasEntry ? "Save" : "Save entry"}
                savedAt={savedAt}
                extraActions={
                  !hasEntry ? (
                    <>
                      <button onClick={cancelWriting} className="btn-ghost">
                        Cancel
                      </button>
                      {actionError && <span className="basis-full text-[13.5px] text-danger">{actionError}</span>}
                    </>
                  ) : (
                    <>
                      {!confirmDelete && (
                        <button onClick={() => setConfirmDelete(true)} className="btn-ghost">
                          Delete
                        </button>
                      )}
                      {!showMove && (
                        <button onClick={() => setShowMove(true)} className="btn-ghost">
                          Move to another day
                        </button>
                      )}
                      {confirmDelete && (
                        <span className="flex basis-full flex-wrap items-center gap-2 text-[13.5px] text-ink-soft">
                          Delete this entry? The conversation and notes stay.
                          <button onClick={handleDelete} className="btn-danger">
                            Delete
                          </button>
                          <button onClick={() => setConfirmDelete(false)} className="btn-ghost">
                            Cancel
                          </button>
                        </span>
                      )}
                      {showMove && (
                        <span className="flex basis-full flex-wrap items-center gap-2">
                          <input
                            type="date"
                            value={moveTo}
                            max={today}
                            onChange={(e) => {
                              setMoveTo(e.target.value);
                              setActionError(null);
                            }}
                            className="input flex-1"
                            aria-label="Move entry to date"
                          />
                          <button onClick={handleMove} disabled={!moveTo} className="btn-subtle">
                            Move
                          </button>
                          <button onClick={() => setShowMove(false)} className="btn-ghost">
                            Cancel
                          </button>
                        </span>
                      )}
                      {actionError && <span className="basis-full text-[13.5px] text-danger">{actionError}</span>}
                    </>
                  )
                }
              />
            </div>
          ) : (
            <div key={selectedDate} className="fade-up flex flex-col gap-5 px-1 pt-2">
              <div>
                <h2 className="page-title">{weekdayOf(selectedDate)}</h2>
                <p className="page-subtitle">
                  {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <p className="font-serif text-[18px] leading-relaxed text-ink-soft">
                {unwrittenDays.has(selectedDate)
                  ? "You talked with Ember on this day, but the entry was never written."
                  : "Nothing was written for this day."}
              </p>
              <div className="flex flex-col gap-2.5">
                <button onClick={() => onTalkAbout?.(selectedDate)} className="btn-primary">
                  {unwrittenDays.has(selectedDate) ? "Open the conversation" : "Talk it through"}
                </button>
                <button onClick={startWriting} className="btn-subtle">
                  Write it myself
                </button>
              </div>
              <p className="hint">
                {unwrittenDays.has(selectedDate)
                  ? "It opens on the Today tab, where you can keep talking or have Ember write the entry."
                  : "Talking it through opens that day’s check-in and conversation on the Today tab, and Ember writes the entry from it."}
              </p>
              {dayNotes && dayNotes.length > 0 && <DayNotes notes={dayNotes} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- the list ----------
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 px-5 pb-12 pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Journal</h1>
            <p className="page-subtitle">
              {entries.length > 0
                ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} so far`
                : "Your entries will collect here"}
            </p>
          </div>
          <button
            onClick={() => setShowCalendar((v) => !v)}
            aria-expanded={showCalendar}
            className="btn-subtle min-h-[36px] rounded-full px-3.5 py-1.5 text-[13.5px]"
          >
            {showCalendar ? "Hide calendar" : "Calendar"}
          </button>
        </div>

        {focus && (
          <div className="fade-up flex items-center gap-2 rounded-full bg-ember-wash/70 py-1 pl-3.5 pr-1 text-[13px] text-ember-deep">
            <span className="min-w-0 flex-1 truncate">
              {focus.label ?? "from Insights"} · {visibleEntries.length} entr{visibleEntries.length === 1 ? "y" : "ies"}
            </span>
            {onClearFocus && (
              <button
                onClick={onClearFocus}
                className="flex h-8 w-8 shrink-0 items-center justify-center text-[18px] leading-none"
                aria-label="Clear filter"
              >
                &times;
              </button>
            )}
          </div>
        )}

        {showCalendar && (
          <div className="fade-up rounded-xl border border-rule bg-sheet/60 px-3 pb-3 pt-2">
            <div className="mb-1 flex items-center justify-between">
              <button onClick={() => shiftMonth(-1)} className="btn-ghost h-10 w-10 text-[20px]" aria-label="Previous month">
                &lsaquo;
              </button>
              <span className="font-serif text-[17px] text-ink">{monthLabel}</span>
              <button onClick={() => shiftMonth(1)} className="btn-ghost h-10 w-10 text-[20px]" aria-label="Next month">
                &rsaquo;
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11.5px] text-ink-faint">
              {WEEKDAY_LABELS.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-y-1">
              {cells.map((dateKey, i) => {
                if (!dateKey) return <div key={i} />;
                const entry = entryByDate.get(dateKey);
                const isFuture = dateKey > today;
                const talked = !entry && unwrittenDays.has(dateKey);
                return (
                  <button
                    key={i}
                    disabled={isFuture}
                    onClick={() => selectDate(dateKey)}
                    aria-label={`${shortDate(dateKey)}${entry ? `: ${entry.title}` : talked ? ": talked, not written up" : ""}`}
                    className={`relative mx-auto flex h-10 w-10 items-center justify-center rounded-full text-[14px] tabular-nums transition-colors duration-200 ${
                      entry ? "text-ink" : talked ? "text-ink" : isFuture ? "text-rule-strong" : "text-ink-faint active:bg-paper-deep"
                    } ${dateKey === today ? "ring-1 ring-ember/50" : ""}`}
                    style={entry ? { background: paperById(entry.paper ?? defaultPaper).bg, boxShadow: "inset 0 0 0 1px rgba(40,35,30,0.12)" } : undefined}
                  >
                    {Number(dateKey.slice(-2))}
                    {entry && <span className="absolute bottom-[4px] h-1 w-1 rounded-full bg-ember" />}
                    {talked && <span className="absolute bottom-[4px] h-1 w-1 rounded-full ring-1 ring-ember" />}
                  </button>
                );
              })}
            </div>
            <p className="hint mt-2 px-1">Tap a day to read it, or to write about one that has no entry.</p>
          </div>
        )}

        {!focus && unwritten.some((u) => u.date < today) && (
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-[15px] italic text-ink-faint">Talked, but not written up</h2>
            <div className="-mx-1 flex flex-wrap gap-1.5">
              {unwritten
                .filter((u) => u.date < today)
                .map((u) => (
                  <button
                    key={u.date}
                    onClick={() => selectDate(u.date)}
                    className="min-h-[36px] rounded-full border border-rule px-3 text-[13.5px] text-ink-soft active:bg-paper-deep"
                  >
                    {shortDate(u.date)}
                  </button>
                ))}
            </div>
          </div>
        )}

        {visibleEntries.length === 0 ? (
          <div className="flex flex-col items-start gap-3 pt-4">
            <p className="font-serif text-[17px] leading-relaxed text-ink-soft">
              {focus
                ? "No saved entries match this filter."
                : "No entries yet. Talk through a day on the Today tab, or write one yourself."}
            </p>
            {!focus && (
              <button onClick={() => selectDate(today)} className="btn-subtle">
                Write about today
              </button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-4 px-1">
            {visibleEntries.map((e, i) => (
              <li key={e.id}>
                <PageCard entry={e} fallbackPaper={defaultPaper} index={i} onOpen={() => selectDate(e.date)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
