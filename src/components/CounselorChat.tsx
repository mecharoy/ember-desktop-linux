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

// A synthetic first turn so the API (which expects the conversation to open
// with a user message) has something to respond to for the AI's own opening
// line. Filtered out of the rendered transcript — the user never typed it.
const KICKOFF = "Let's begin today's conversation.";
const KICKOFF_PAST = "Let's look back on that day.";
// The first one is what older versions stored.
const KICKOFFS = new Set(["Let's begin tonight's check-in.", KICKOFF, KICKOFF_PAST]);

const MAX_INPUT_HEIGHT_PX = 160;

type View = "notes" | "conversation" | "journal";

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

/** The conversation for one day: today, or an earlier day picked from
 * the Journal calendar. Everything below keys off `date`, never the clock. */
export default function CounselorChat({
  date,
  notes,
  notesCount = 0,
}: {
  date: string;
  /** The day's notes, shown as the first of the three pages on a phone. Gets a
   *  callback that turns to the conversation. */
  notes?: (goTalk: () => void) => React.ReactNode;
  notesCount?: number;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [view, setView] = useState<View>("conversation");
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
      // A day with nothing said yet opens on its notes; the check-in waits
      // under Talk.
      setView(s.status === "wrapped" ? "journal" : loaded.length > 0 || !notes ? "conversation" : "notes");
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

  // While the conversation is on screen, background jobs keep off the model.
  useEffect(() => {
    if (view !== "conversation") return;
    noteConversation();
    const timer = setInterval(noteConversation, 60_000);
    return () => clearInterval(timer);
  }, [view]);

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
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
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

  /** Wrap the session, switch to the day's journal, and have it written + saved. */
  async function requestWrite() {
    if (!session) return;
    await makeRoomForConversation();
    if (session.status !== "wrapped") {
      await wrapSession(session.id);
      setSession({ ...session, status: "wrapped" });
    }
    setView("journal");
    setWriteNow(true);
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
    setView("conversation");
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
    setView("conversation");
  }

  if (!session) {
    return <p className="py-2 text-[13px] text-ink-faint">Loading&hellip;</p>;
  }

  const isToday = date === localDateKey();
  const showChecklist = !friendMode && (agenda !== null || agendaState !== "idle");
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

  const tabs: { id: View; label: string }[] = [
    ...(notes ? [{ id: "notes" as const, label: notesCount > 0 ? `Notes · ${notesCount}` : "Notes" }] : []),
    { id: "conversation", label: "Talk" },
    { id: "journal", label: isToday ? "Journal" : "The entry" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* The day's pages: its notes, the conversation, the entry it produces. */}
      <div className="flex border-b border-rule px-5" role="group" aria-label="Show">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            aria-pressed={view === t.id}
            className={`-mb-px flex-1 border-b-2 pb-2.5 pt-1 text-[14.5px] transition-colors duration-200 ${
              view === t.id ? "border-ember text-ink" : "border-transparent text-ink-faint"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === "conversation" && started && (
        <div className="flex min-h-[44px] flex-wrap items-center justify-end gap-1 px-3 pt-1">
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
            <span className="flex flex-wrap items-center justify-end gap-1 text-[13.5px] text-ink-faint">
              Clear this conversation and start again from
              <button onClick={() => handleRestart(true)} className="btn-ghost text-ember">
                The check-in
              </button>
              <button onClick={() => handleRestart(false)} className="btn-ghost text-ember">
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

      {/* Stays mounted across tabs, like the conversation itself: leaving this
          tab mid-generation must not cut off the entry it's writing. */}
      <div className={view === "journal" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <EntryReview
          sessionId={session.id}
          date={date}
          transcript={visibleMessages.map((m) => ({ role: m.role, content: m.content }))}
          writeNow={writeNow}
          onWriteHandled={() => setWriteNow(false)}
          onRequestWrite={requestWrite}
        />
      </div>
      {view === "notes" && notes ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{notes(() => setView("conversation"))}</div>
      ) : null}
      {/* Kept mounted while another tab is shown, so a half-filled check-in
          isn't lost by looking at the notes. */}
      {!started && !wrapped && (
        <div className={view === "conversation" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          {agendaState === "making" && <div className="px-5 pt-5">{checklist(true)}</div>}
          <div className={agendaState === "making" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
            <CheckInForm date={date} busy={busy} onStart={handleStart} onSkip={handleStart} />
          </div>
        </div>
      )}
      {view === "conversation" && (started || wrapped) && (
        <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {showChecklist && <div className="md:hidden">{checklist(true)}</div>}
          <div ref={scrollerRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {visibleMessages.length === 0 && wrapped && (
              <p className="py-6 text-center font-serif text-[15px] italic text-ink-faint">
                No conversation this time. The entry was written from your notes.
              </p>
            )}
            {visibleMessages.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} settle={m.role === "user" && m.id >= firstNewIdRef.current} />
            ))}
            {streaming !== null &&
              (streaming.length > 0 ? (
                <Bubble role="assistant" content={hideMarkersWhileStreaming(streaming)} streaming settle />
              ) : (
                <ThinkingIndicator />
              ))}
            {stalled !== null && streaming === null && <Bubble role="assistant" content={stalled} interrupted />}
            <div ref={bottomRef} />
          </div>
          {wrapped ? (
            <p className="border-t border-rule px-5 py-3 text-[13px] leading-relaxed text-ink-faint">
              {isToday
                ? "This conversation is wrapped up and the entry is under Journal."
                : "This conversation is wrapped up and the entry is saved."}{" "}
              Keep talking to add more, and Ember can rewrite the entry.
            </p>
          ) : (
            <div className="border-t border-rule/60 bg-paper px-3 pb-3 pt-2">
              <div className="flex items-end gap-2 rounded-2xl border border-rule bg-sheet py-1.5 pl-4 pr-1.5 transition-colors duration-200 focus-within:border-rule-strong">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Desktop convention: Enter sends, Shift+Enter makes a new line.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Write back…"
                  disabled={busy}
                  className="flex-1 resize-none overflow-y-auto bg-transparent py-2 font-serif text-[17px] leading-[1.45] text-ink outline-none placeholder:text-ink-faint/80 focus-visible:outline-none disabled:opacity-60"
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
        {showChecklist && <div className="hidden md:flex">{checklist(false)}</div>}
        </div>
      )}

      {error && view === "conversation" && (
        <div className="fade-up mx-3 mb-2 flex items-start justify-between gap-3 rounded-lg bg-danger-wash px-3 py-2.5 text-[13.5px] text-danger">
          <div>
            {error.message}
            {error.hint && <span className="mt-0.5 block opacity-80">{error.hint}</span>}
          </div>
          <button
            onClick={handleRetry}
            disabled={busy}
            className="min-h-[36px] shrink-0 rounded-md border border-danger/40 px-3 py-1 transition-colors active:bg-paper/60 disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/** Shown between sending and the first visible token — thinking models can
 * take a while before any text arrives, and an empty page reads as a dead
 * chat. The ember breathes until words arrive. */
function ThinkingIndicator() {
  return (
    <div className="fade-up flex items-center py-1.5" role="status">
      <span className="ember-dot live" aria-hidden="true" />
      <span className="sr-only">Ember is writing a reply</span>
    </div>
  );
}

/** Ember writes on the page in the serif; your replies sit to the right like
 * notes in a margin. No bubbles. */
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
      <div className={`flex justify-end ${settle ? "ink-in" : ""}`}>
        <div className="selectable max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-paper-deep px-4 py-2.5 text-[15.5px] leading-relaxed text-ink-soft">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`selectable whitespace-pre-wrap font-serif text-[17.5px] leading-[1.6] text-ink ${settle ? "ink-in" : ""} ${
        interrupted ? "opacity-75" : ""
      }`}
    >
      {content}
      {streaming && <span className="stream-caret" aria-hidden="true" />}
      {interrupted && (
        <span className="mt-1.5 block font-sans text-[11.5px] italic text-ink-faint">Cut off here. Press Retry for the rest.</span>
      )}
    </div>
  );
}
