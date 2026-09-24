import { useEffect, useRef, useState } from "react";
import { localDateKey } from "../time";
import {
  addMessage,
  getOrCreateTodaySession,
  linkCapturesToSession,
  listMessages,
  reopenSession,
  restartConversation,
  wrapSession,
} from "../db/sessions";
import type { Message, Session } from "../db/types";
import { createReminder } from "../db/reminders";
import { buildCounselorSystemPrompt, buildCounselorTurnPreamble } from "../ai/context";
import { getProvider } from "../ai/factory";
import { extractReminders, hideMarkersWhileStreaming } from "../ai/reminders";
import { extractJournalRequest } from "../ai/journalMarker";
import { ProviderError } from "../ai/types";
import { nowLocalMinute } from "../scheduler";
import { emit, listen } from "@tauri-apps/api/event";
import type { ApplyResult } from "../db/sync";
import EntryReview from "./EntryReview";
import { makeRoomForConversation, noteConversation } from "../ai/modelActivity";
import CheckInForm from "./CheckInForm";
import ChecklistPanel from "./ChecklistPanel";
import { deleteAgenda, getAgenda, saveAgenda, saveChatSummary } from "../db/agendas";
import { prepareConversation } from "../ai/prepare";
import { fitTurn } from "../ai/window";
import { contextBudget } from "../ai/budget";
import { getSetting } from "../db/settings";
import { extractCovered, markCovered } from "../ai/agenda";
import { parseStyle } from "../ai/prompts/style";
import type { AgendaItem } from "../db/types";
import Wingbeat from "./Wingbeat";
import DaySeam from "./DaySeam";
import Beetle from "../mascot/Beetle";
import { typing, useHidePerch, useMascotClaim } from "../mascot/pulse";

// A synthetic first turn so the API (which expects the conversation to open
// with a user message) has something to respond to for the AI's own opening
// line. Filtered out of the rendered transcript — the user never typed it.
const KICKOFF = "Let's begin today's conversation.";
const KICKOFF_PAST = "Let's look back on that day.";
// The first one is what older versions stored.
const KICKOFFS = new Set(["Let's begin tonight's check-in.", KICKOFF, KICKOFF_PAST]);

const MAX_INPUT_HEIGHT_PX = 160;

interface DisplayError {
  message: string;
  hint?: string;
}

function toDisplayError(e: unknown): DisplayError {
  if (e instanceof ProviderError) return { message: e.message, hint: e.hint };
  if (e instanceof Error) return { message: e.message };
  return { message: "Something went wrong talking to the AI provider." };
}

type Turn = { history: { role: "user" | "assistant"; content: string }[]; sessionId: number };

/**
 * One day, as a single column: the notes it collected, the conversation, and
 * the entry it became — in that order, all scrolling together, with the
 * composer pinned underneath.
 *
 * There are no sub-tabs. The three bands are divided by nothing but a labelled
 * punctation rule (DaySeam), so the whole day is one thing you scroll rather
 * than three places you switch between.
 *
 * Everything below keys off `date`, never the clock.
 */
export default function CounselorChat({
  date,
  notes,
  active = true,
}: {
  date: string;
  /** False while the page is kept mounted but hidden behind another tab. */
  active?: boolean;
  /** The day's notes, the top band of the column. Gets a callback that brings
   *  the talk into view and puts the cursor in the composer. */
  notes?: (goTalk: () => void) => React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Set when the user — or the counselor, on their say-so — asks for the
  // journal; EntryReview writes and saves it, then clears this.
  const [writeNow, setWriteNow] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  // A partial reply kept on provider failure, so streamed text never vanishes.
  const [stalled, setStalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Two-step, because starting over discards the exchange for good.
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  // Today's checklist (coach and therapist styles); null = none made.
  const [agenda, setAgenda] = useState<AgendaItem[] | null>(null);
  const [agendaState, setAgendaState] = useState<"idle" | "making" | "failed">("idle");
  const [friendMode, setFriendMode] = useState(false);
  const agendaRef = useRef<AgendaItem[] | null>(null);
  agendaRef.current = agenda;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const talkRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastTurnRef = useRef<Turn | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  // Messages already saved when the chat opened appear as they are; only the
  // ones sent while it's open settle in with the ink animation.
  const firstNewIdRef = useRef(Number.POSITIVE_INFINITY);
  // Assembled once per session and then reused verbatim. Rebuilding it would
  // usually produce the same string, but "usually" is not good enough: any
  // difference (a capture added mid-conversation, a setting changed) throws
  // away the cached prefix for the rest of the night. A stable view of the
  // day is also the more sensible thing for the counselor to reason from.
  const systemPromptRef = useRef<{ sessionId: number; prompt: string } | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getOrCreateTodaySession(date);
      setSession(s);
      const loaded = await listMessages(s.id);
      firstNewIdRef.current = loaded.reduce((max, m) => Math.max(max, m.id), 0) + 1;
      setMessages(loaded);
      setAgenda(await getAgenda(date));
      setFriendMode(parseStyle("", await getSetting("conversation_approach")).approach === "friend");
    })();
  }, [date]);

  // The style can change in Settings while this page stays open.
  useEffect(() => {
    const unlisten = listen("settings:saved", async () => {
      setFriendMode(parseStyle("", await getSetting("conversation_approach")).approach === "friend");
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // While a live conversation is on screen, background jobs keep off the model.
  // The whole day is one page now, so this is "the talk is open", not "the
  // Talk tab is showing".
  const talking = session !== null && session.status !== "wrapped";
  useEffect(() => {
    if (!talking) return;
    noteConversation();
    const timer = setInterval(noteConversation, 60_000);
    return () => clearInterval(timer);
  }, [talking]);

  // The other device wrote to this day (a sync): show it, unless a reply is
  // arriving here right now, in which case the next sync brings it.
  useEffect(() => {
    const unlisten = listen<ApplyResult>("sync:applied", async (event) => {
      if (!event.payload.dates.includes(date) || busyRef.current) return;
      const s = await getOrCreateTodaySession(date);
      const loaded = await listMessages(s.id);
      if (busyRef.current) return;
      setSession(s);
      setMessages(loaded);
      setAgenda(await getAgenda(date));
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, [date]);

  // Autoscroll only when the user is already near the bottom — never yank
  // the view away from something they scrolled up to reread.
  //
  // And never on the first pass. The whole day is one column now, so "scroll
  // to the last message" on mount means "scroll the notes off the top of the
  // screen", which is the opposite of what opening a day should do. A day
  // always opens at its beginning.
  const settled = useRef(false);
  useEffect(() => {
    settled.current = false;
  }, [date]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!settled.current) {
      settled.current = true;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: streaming !== null ? "auto" : "smooth" });
    }
  }, [messages, streaming, stalled]);

  // Auto-grow the input with its content, capped so it never eats the chat.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [draft]);

  async function counselorSystemFor(sessionId: number): Promise<string> {
    const cached = systemPromptRef.current;
    if (cached && cached.sessionId === sessionId) return cached.prompt;
    const prompt = await buildCounselorSystemPrompt(date);
    systemPromptRef.current = { sessionId, prompt };
    return prompt;
  }

  /** Brings a band of the day into view. The column's own scroller, not the
   *  window's, so `scrollIntoView` is aimed at the right box. */
  function reveal(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Wrap the session, scroll down to the entry, and have it written + saved. */
  async function requestWrite() {
    if (!session) return;
    await makeRoomForConversation();
    if (session.status !== "wrapped") {
      await wrapSession(session.id);
      setSession({ ...session, status: "wrapped" });
    }
    setWriteNow(true);
    // The entry is the bottom of the column; writing it is the one moment the
    // page should move on its own.
    requestAnimationFrame(() => reveal(entryRef));
  }

  async function runTurn(historyForModel: Turn["history"], sessionId: number) {
    lastTurnRef.current = { history: historyForModel, sessionId };
    setBusy(true);
    setError(null);
    setStalled(null);
    setStreaming("");

    let stopRequested = false;
    const stopPromise = new Promise<void>((resolve) => {
      stopRef.current = () => {
        stopRequested = true;
        resolve();
      };
    });

    let full = "";
    let journalRequested = false;
    try {
      const exchangeCount = historyForModel.filter((m) => m.role === "user").length;
      const [system, preamble] = await Promise.all([
        counselorSystemFor(sessionId),
        buildCounselorTurnPreamble({ exchangeCount, date }),
      ]);
      // A background job on the local model would make this reply wait.
      await makeRoomForConversation();
      const provider = await getProvider();
      // conversationId lets a provider resume its own session for turn 2+
      // instead of replaying the transcript; providers that can't just ignore
      // it. turnPreamble is applied by the provider, not here, so the history
      // it sees stays exactly what's in the database.
      // Small models get a rolling window: older turns become a summary.
      const fitted = await fitTurn({ date, system, history: historyForModel, preamble });
      const iterator = provider
        .chatStream(fitted.history, system, {
          conversationId: String(sessionId),
          turnPreamble: fitted.preamble,
        })
        [Symbol.asyncIterator]();

      while (true) {
        const next = await Promise.race([
          iterator.next(),
          stopPromise.then(() => "stopped" as const),
        ]);
        if (next === "stopped") {
          // Closing the iterator runs the providers' cleanup (kills the CLI
          // process / cancels the HTTP stream).
          try {
            await iterator.return?.();
          } catch {
            // cleanup is best-effort
          }
          break;
        }
        if (next.done) break;
        full += next.value;
        setStreaming(full);
      }

      if (full.trim().length === 0) {
        if (stopRequested) return; // stopped before anything arrived — no-op
        throw new ProviderError("The model returned an empty reply.");
      }
      // Markers come out before anything is stored or shown; the reply itself
      // is never lost to a bad marker (they're just stripped).
      const { clean, reminders } = extractReminders(full, nowLocalMinute());
      for (const r of reminders) await createReminder(r.dueAt, r.text);
      if (reminders.length > 0) await emit("reminders:changed");
      // A stopped-midway reply is still what the user read — keep it, but a
      // write request inside a cut-off reply isn't trusted.
      const journal = extractJournalRequest(clean.length > 0 ? clean : full);
      journalRequested = journal.requested && !stopRequested;
      const covered = extractCovered(journal.clean);
      const current = agendaRef.current;
      if (covered.ids.length > 0 && current) await updateAgenda(markCovered(current, covered.ids));
      await addMessage(sessionId, "assistant", covered.clean || "Writing the entry now.");
      setMessages(await listMessages(sessionId));
    } catch (e) {
      // An interrupted reply is display-only: hide marker syntax but don't
      // act on it — a half-arrived marker can't be trusted.
      if (full.trim().length > 0) setStalled(hideMarkersWhileStreaming(full));
      setError(toDisplayError(e));
    } finally {
      stopRef.current = null;
      setStreaming(null);
      setBusy(false);
    }
    if (journalRequested) await requestWrite();
  }

  async function updateAgenda(items: AgendaItem[]) {
    setAgenda(items);
    await saveAgenda(date, items);
  }

  /** Makes the checklist from the check-in, notes, entries and topics. A
   *  failure leaves the conversation to go ahead without one. */
  async function makeAgenda() {
    const approach = parseStyle("", await getSetting("conversation_approach")).approach;
    // Friend style has no checklist; with a small model it still gets the
    // briefing the preparation writes.
    if (approach === "friend" && (await contextBudget()).mode === "full") return;
    setAgendaState("making");
    try {
      await makeRoomForConversation();
      const { items } = await prepareConversation(date, approach);
      if (items) {
        await updateAgenda(items);
        setAgendaState("idle");
      } else setAgendaState(approach === "friend" ? "idle" : "failed");
    } catch {
      setAgendaState("failed");
    }
  }

  async function handleStart() {
    if (!session || busy) return;
    const kickoff = date === localDateKey() ? KICKOFF : KICKOFF_PAST;
    setBusy(true);
    try {
      if (!agendaRef.current) await makeAgenda();
    } finally {
      setBusy(false);
    }
    await linkCapturesToSession(session.id, date);
    await addMessage(session.id, "user", kickoff);
    setMessages(await listMessages(session.id));
    await runTurn([{ role: "user", content: kickoff }], session.id);
  }

  async function handleSend() {
    if (!session || busy || !draft.trim()) return;
    const userText = draft.trim();
    setDraft("");
    await addMessage(session.id, "user", userText);
    const updated = await listMessages(session.id);
    setMessages(updated);
    await runTurn(
      updated.map((m) => ({ role: m.role, content: m.content })),
      session.id,
    );
  }

  function handleStop() {
    stopRef.current?.();
  }

  async function handleRetry() {
    const turn = lastTurnRef.current;
    if (!turn || busy) return;
    await runTurn(turn.history, turn.sessionId);
  }

  /** Wipes tonight's exchange. With `redoCheckIn` it goes back to the check-in
   *  form (filled in with the saved scores, to change); otherwise it opens a
   *  fresh conversation from the same check-in and notes. */
  async function handleRestart(redoCheckIn: boolean) {
    if (!session || busy) return;
    setConfirmRestart(false);
    await restartConversation(session.id);
    await saveChatSummary(date, null, 0);
    // The system prompt is cached per session id — it has to forget the old
    // thread, or the "fresh" conversation carries it on.
    systemPromptRef.current = null;
    lastTurnRef.current = null;
    firstNewIdRef.current = Number.POSITIVE_INFINITY;
    setMessages([]);
    setStreaming(null);
    setStalled(null);
    setError(null);
    setDraft("");
    setWriteNow(false);
    setSession({ ...session, status: "open" });
    if (redoCheckIn) {
      // A new check-in gets a new checklist.
      await deleteAgenda(date);
      setAgenda(null);
    } else if (agendaRef.current) {
      await updateAgenda(agendaRef.current.map((i) => (i.state === "done" ? { ...i, state: "open" } : i)));
    }
    if (!redoCheckIn) await handleStart();
  }

  async function handleReopen() {
    if (!session) return;
    await reopenSession(session.id);
    setSession({ ...session, status: "open" });
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Above the early return below: a hook after a conditional `return` runs on
  // some renders and not others, which is React error #310 and takes the whole
  // app down with it.
  //
  // Two states, not one. Reading the day before a conversation starts is the
  // beetle FLYING — it has gone off to fetch something — while waiting on a
  // reply is thinking. Thinking outranks flying (mascot/pulse.ts), so the
  // chat claim has to stand down while the day is being read or the flight
  // would never show.
  const readingTheDay = agendaState === "making";
  useMascotClaim("prepare", "flying", readingTheDay);
  useMascotClaim("chat", "thinking", busy && !readingTheDay);
  // The composer (below) carries its own beetle, so while it shows, the
  // perch's beetle steps aside: one beetle on screen at a time.
  useHidePerch("composer", active && session !== null && messages.length > 0 && session.status !== "wrapped");

  if (!session) {
    return <p className="py-2 text-[13px] text-fg-faint">Loading&hellip;</p>;
  }

  const isToday = date === localDateKey();
  const talkStarted = messages.length > 0;
  const isWrapped = session.status === "wrapped";
  // Choosing to write the entry ENDS the preparation. The checklist is made in
  // the background when a conversation starts, and it used to land on screen
  // afterwards even if you had meanwhile pressed "Write it from my notes" — so
  // pressing write appeared to open a checklist, on a day that was already
  // being written. Nothing cancels the request itself (it is harmless and its
  // result is kept for the date); it simply stops being shown.
  const writingInstead = isWrapped || writeNow;
  const preparing = agendaState === "making" && !writingInstead;
  const showChecklist =
    !friendMode && !writingInstead && !(isWrapped && !talkStarted) && (agenda !== null || agendaState !== "idle");
  const checklist = (compact: boolean) => (
    <ChecklistPanel
      compact={compact}
      items={agenda}
      making={agendaState === "making"}
      failed={agendaState === "failed"}
      onChange={updateAgenda}
      onRemake={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await makeAgenda();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  const visibleMessages = messages.filter((m) => !(m.role === "user" && KICKOFFS.has(m.content)));
  const started = messages.length > 0;
  const wrapped = session.status === "wrapped";

  /** From the reminder banner up in the notes: bring the talk into view and
   *  put the cursor where you would type. */
  function goTalk() {
    reveal(talkRef);
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 px-5 pb-10 pt-2">
          {/* 1 — what you noted while the day was happening. */}
          {notes && notes(goTalk)}

          {/* 2 — the talk. */}
          <section ref={talkRef} className="flex flex-col gap-4">
            <DaySeam label="The talk" />

            {/* While the day is being read, say so plainly and hold the
                attention here. A collapsed "Getting ready…" row next to a
                bright button in the entry band sent people off to write the
                entry instead of having the conversation that was starting. */}
            {preparing ? (
              <div className="punct-field flex items-center gap-3 rounded-xl px-5 py-5" role="status">
                <Wingbeat />
                <span className="text-[15px] leading-snug text-fg-dim">Reading your day before we start&hellip;</span>
              </div>
            ) : (
              showChecklist && <div className="md:hidden">{checklist(true)}</div>
            )}

            {/* Kept mounted once started so a half-filled check-in is never
                lost, and so a reply still arriving is never cut off. */}
            {!started && !wrapped && agendaState !== "making" && (
              <CheckInForm date={date} busy={busy} onStart={handleStart} onSkip={handleStart} />
            )}

            {(started || wrapped) && (
              <div className="flex flex-col gap-5">
                {visibleMessages.length === 0 && wrapped && (
                  <p className="text-[14.5px] text-fg-faint">
                    No conversation this time. The entry was written from your notes.
                  </p>
                )}
                {visibleMessages.map((m) => (
                  <Bubble
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    settle={m.role === "user" && m.id >= firstNewIdRef.current}
                  />
                ))}
                {streaming !== null &&
                  (streaming.length > 0 ? (
                    <Bubble role="assistant" content={hideMarkersWhileStreaming(streaming)} streaming settle />
                  ) : (
                    <ThinkingIndicator />
                  ))}
                {stalled !== null && streaming === null && <Bubble role="assistant" content={stalled} interrupted />}
                {/* A new reply scrolls to the end of the TALK, not the end of
                    the page — otherwise answering a question jumps you past
                    the answer and down to the entry. */}
                <div ref={bottomRef} />
              </div>
            )}

            {started && (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {!wrapped && !confirmRestart && (
                  <>
                    <button onClick={() => setConfirmRestart(true)} disabled={busy} className="btn-ghost">
                      Start over
                    </button>
                    <button onClick={requestWrite} disabled={busy} className="btn-subtle min-h-[36px] py-1.5">
                      Wrap up &amp; write
                    </button>
                  </>
                )}
                {!wrapped && confirmRestart && (
                  <span className="flex flex-wrap items-center justify-end gap-1 text-[13.5px] text-fg-faint">
                    Clear this conversation and start again from
                    <button onClick={() => handleRestart(true)} className="btn-ghost text-moss">
                      The check-in
                    </button>
                    <button onClick={() => handleRestart(false)} className="btn-ghost text-moss">
                      Just the talk
                    </button>
                    <button onClick={() => setConfirmRestart(false)} className="btn-ghost">
                      Keep it
                    </button>
                  </span>
                )}
                {wrapped && (
                  <button onClick={handleReopen} className="btn-ghost">
                    Keep talking
                  </button>
                )}
              </div>
            )}
          </section>

          {/* 3 — what the day became. */}
          <section ref={entryRef} className="flex flex-col gap-4">
            <DaySeam label="The entry" />
            <EntryReview
              sessionId={session.id}
              date={date}
              transcript={visibleMessages.map((m) => ({ role: m.role, content: m.content }))}
              writeNow={writeNow}
              onWriteHandled={() => setWriteNow(false)}
              onRequestWrite={requestWrite}
            />
          </section>
        </div>
      </div>

      {/* On a wide window the checklist stands beside the day rather than in
          it, so it stays in view for the whole conversation — that is the
          point of a checklist. Narrow windows get the compact one inline. */}
      {showChecklist && (
        <aside className="hidden w-[18.5rem] shrink-0 overflow-y-auto overflow-x-hidden border-l border-line md:block">
          {checklist(false)}
        </aside>
      )}
      </div>

      {error && (
        <div className="fade-up mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg bg-danger-wash px-3 py-2.5 text-[13.5px] text-danger">
          <div>
            {error.message}
            {error.hint && <span className="mt-0.5 block opacity-80">{error.hint}</span>}
          </div>
          <button
            onClick={handleRetry}
            disabled={busy}
            className="min-h-[36px] shrink-0 rounded-md border border-danger/40 px-3 py-1 transition-colors active:bg-ground/60 disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}

      {/* The composer is the one thing that does not scroll: once the talk is
          going, the day is answerable from wherever you are in it. Before it
          starts there is nothing to write back TO — the check-in's own button
          is the way in — and a greyed-out composer just reads as broken. */}
      {!started && !wrapped ? null : wrapped ? (
        <p className="border-t border-line px-5 py-3 text-[13px] leading-relaxed text-fg-faint">
          {isToday ? "This day is wrapped up and its entry is saved." : "This day is wrapped up and its entry is saved."}{" "}
          Keep talking to add more, and Elytra can rewrite the entry.
        </p>
      ) : (
        <div className="border-t border-line/60 bg-ground px-3 pb-3 pt-2">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface py-1.5 pl-2.5 pr-1.5 transition-colors duration-200 focus-within:border-line-strong">
            {/* In the composer, where your eyes already are. It is not driven
                from here: it follows whatever the app has claimed through
                mascot/pulse.ts — listening while you type, idle when you stop,
                the save snap, and thinking while a reply is on its way. While it
                shows, the perch beside the dock steps aside (useHidePerch). */}
            <Beetle size={44} className="mb-0.5 shrink-0 self-end" />
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                typing();
              }}
              onKeyDown={(e) => {
                // Desktop convention: Enter sends, Shift+Enter makes a new line.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Write back…"
              disabled={busy}
              className="flex-1 resize-none overflow-y-auto bg-transparent py-2 font-serif text-[17px] leading-[1.45] text-fg outline-none placeholder:text-fg-faint/80 focus-visible:outline-none disabled:opacity-60"
              style={{ maxHeight: MAX_INPUT_HEIGHT_PX }}
            />
            {busy ? (
              <button onClick={handleStop} className="btn-subtle rounded-full">
                Stop
              </button>
            ) : (
              <button onClick={handleSend} disabled={!draft.trim()} className="btn-primary rounded-full px-4">
                Send
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown between sending and the first visible token — thinking models can
 * take a while before any text arrives, and an empty page reads as a dead
 * chat. The wings beat until words arrive. */
function ThinkingIndicator() {
  return (
    <div className="fade-up flex w-fit items-center gap-2.5 rounded-[14px] bg-speak px-4 py-3" role="status">
      <Wingbeat tone="cream" />
      <span className="font-mono text-[9.5px] uppercase leading-none tracking-[0.16em] text-speak-fg/80">Reading the day</span>
      <span className="sr-only">Elytra is writing a reply</span>
    </div>
  );
}

/**
 * Who is speaking is never a guess. Elytra's questions sit in a filled green
 * card under a small label; what you wrote is plain text on the page, the way
 * the rest of the journal is. The page belongs to you; the green is the app
 * asking.
 */
function Bubble({
  role,
  content,
  streaming = false,
  interrupted = false,
  settle = false,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  interrupted?: boolean;
  settle?: boolean;
}) {
  if (role === "user") {
    return (
      <div className={`selectable whitespace-pre-wrap pl-1 text-[16.5px] leading-[1.6] text-fg ${settle ? "ink-in" : ""}`}>
        {content}
      </div>
    );
  }
  return (
    <div
      className={`max-w-[38rem] rounded-[14px] bg-speak px-4 pb-3 pt-2.5 ${settle ? "ink-in" : ""} ${
        interrupted ? "opacity-75" : ""
      }`}
    >
      <span className="block font-mono text-[9.5px] uppercase leading-none tracking-[0.16em] text-speak-fg/80">Elytra asks</span>
      <p className="selectable mt-1.5 whitespace-pre-wrap text-[16.5px] leading-[1.5] text-speak-fg">
        {content}
        {streaming && <span className="stream-caret" aria-hidden="true" />}
      </p>
      {interrupted && (
        <span className="mt-1.5 block text-[11.5px] italic text-speak-fg/70">Cut off here. Press Retry for the rest.</span>
      )}
    </div>
  );
}
