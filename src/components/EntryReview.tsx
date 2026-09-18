import { useEffect, useState } from "react";
import { listUnjournaledCaptures } from "../db/captures";
import { localDateKey } from "../time";
import { getEntryForDate, saveEntry, setEntryPaper } from "../db/entries";
import { getProfileSummary } from "../db/profile";
import { getSetting } from "../db/settings";
import { getCheckIn } from "../db/checkins";
import { generateJournalEntry } from "../ai/journal";
import { runDayExtraction } from "../ai/extractor";
import { updateTopicsAfterConversation } from "../ai/topics";
import { formatCheckInForPrompt, toCheckInSummary } from "../ai/checkin";
import type { Message } from "../db/types";
import EntryFields, { type EntryDraft } from "./EntryFields";

interface Props {
  sessionId: number;
  date: string;
  transcript: Pick<Message, "role" | "content">[];
  /** Set by the chat when the user (or the counselor, on their say-so) asked
   * for the entry to be written. Cleared through onWriteHandled. */
  writeNow: boolean;
  onWriteHandled: () => void;
  /** "Write it now" from the empty state — the chat wraps the session and
   * sets writeNow. */
  onRequestWrite: () => void;
}

type Phase = "loading" | "empty" | "generating" | "ready" | "fallback";

/**
 * The day's journal. Ember writes the entry and saves it on the user's behalf
 * (it stays fully editable). The one thing it never does unasked is replace
 * an entry the user has edited by hand — that needs a click.
 */
export default function EntryReview({ sessionId, date, transcript, writeNow, onWriteHandled, onRequestWrite }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [userEdited, setUserEdited] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [writtenByEmber, setWrittenByEmber] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Chosen paper; null = the default from Settings. Kept with the entry once saved.
  const [paper, setPaper] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const existing = await getEntryForDate(date);
      if (!existing) {
        setPhase("empty");
        return;
      }
      let highlights: string[] = [];
      try {
        const parsed = JSON.parse(existing.highlights || "[]");
        if (Array.isArray(parsed)) highlights = parsed.filter((h) => typeof h === "string");
      } catch {
        // corrupt highlights JSON — keep the entry usable with none
      }
      setDraft({
        title: existing.title,
        narrative: existing.narrative,
        highlights,
        counselorNote: existing.counselor_note,
      });
      setUserEdited(existing.user_edited === 1);
      setPaper(existing.paper);
      setSavedAt(Date.now());
      setPhase("ready");
    })();
  }, [date]);

  // A write request: a fresh day gets written and saved; an existing entry is
  // rewritten from the (longer) conversation — unless the user edited it by
  // hand, in which case they're asked first.
  useEffect(() => {
    if (!writeNow || phase === "loading" || phase === "generating") return;
    onWriteHandled();
    // The fallback template counts as edited only so it isn't mislabelled as
    // Ember's writing — it isn't the user's work, so no confirmation for it.
    if (phase === "ready" && userEdited) {
      setConfirmOverwrite(true);
      return;
    }
    void runGeneration();
  }, [writeNow, phase]);

  async function persist(d: EntryDraft, edited: boolean) {
    await saveEntry({
      sessionId,
      date,
      title: d.title,
      narrative: d.narrative,
      highlights: d.highlights,
      counselorNote: d.counselorNote,
      userEdited: edited,
    });
    if (paper) await setEntryPaper(date, paper);
    setSavedAt(Date.now());
    // Extraction runs in the background after the save is already durable —
    // a model failure stores null metrics and never surfaces here.
    void runDayExtraction({
      date,
      entry: { title: d.title, narrative: d.narrative, highlights: d.highlights, counselorNote: d.counselorNote },
      transcript,
    })
      // Then the topics Ember keeps across conversations (coach and therapist).
      .then(() => updateTopicsAfterConversation(date, transcript))
      .catch(() => {});
  }

  async function runGeneration(feedbackNote?: string, previousEntry?: EntryDraft) {
    setPhase("generating");
    setConfirmOverwrite(false);
    setErrorMessage(null);
    // Everything no entry covers yet, not just this date's — saving this
    // entry is what clears the backlog.
    const [captures, voiceSetting, profileSummary, checkInRow, writingStyle] = await Promise.all([
      listUnjournaledCaptures(date),
      getSetting("voice"),
      getProfileSummary(),
      getCheckIn(date),
      getSetting("writing_style_sample"),
    ]);

    const result = await generateJournalEntry({
      date,
      captures,
      transcript,
      profileSummary: profileSummary ?? undefined,
      checkIn: formatCheckInForPrompt(toCheckInSummary(checkInRow)),
      voice: voiceSetting === "first" ? "first" : "second",
      writingStyle,
      feedbackNote,
      // On regeneration the model needs the entry it's rewriting — feedback
      // like "make it shorter" has no referent otherwise.
      previousEntry: previousEntry
        ? {
            title: previousEntry.title,
            narrative: previousEntry.narrative,
            highlights: previousEntry.highlights,
            counselorNote: previousEntry.counselorNote,
          }
        : undefined,
    });

    if (result.ok) {
      const written: EntryDraft = {
        title: result.entry.title,
        narrative: result.entry.narrative,
        highlights: result.entry.highlights,
        counselorNote: result.entry.counselor_note,
      };
      setDraft(written);
      setUserEdited(false);
      setPhase("ready");
      await persist(written, false);
      setWrittenByEmber(true);
    } else {
      // Never auto-save the fallback: a template of raw notes would mark the
      // day as journaled when it hasn't really been written.
      setErrorMessage(result.error);
      setDraft({
        title: `Notes from ${date}`,
        narrative:
          captures.length > 0
            ? captures
                .slice()
                .reverse()
                .map((c) => `${c.created_at.slice(11, 16)}: ${c.text}`)
                .join("\n")
            : "",
        highlights: [],
        counselorNote: "",
      });
      setUserEdited(true);
      setSavedAt(null);
      setPhase("fallback");
    }
  }

  async function handlePaper(id: string) {
    setPaper(id);
    // Only an entry that exists has a row to keep it on; a draft takes it
    // along when it is first saved (persist).
    if (savedAt) await setEntryPaper(date, id).catch(() => {});
  }

  async function handleSave() {
    if (!draft) return;
    await persist(draft, userEdited);
    setWrittenByEmber(false);
  }

  async function handleRegenerate() {
    const note = feedback.trim();
    setFeedback("");
    setShowFeedback(false);
    setConfirmDiscard(false);
    await runGeneration(note || undefined, draft ?? undefined);
  }

  if (phase === "loading" || phase === "generating") {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 p-8 pt-24">
        {phase === "generating" && <span className="ember-dot live" aria-hidden="true" />}
        <span className={phase === "generating" ? "font-serif text-[16px] italic text-ink-soft" : "text-[13px] text-ink-faint"}>
          {phase === "generating" ? "Writing the entry…" : "Loading…"}
        </span>
      </div>
    );
  }

  if (phase === "empty") {
    const talked = transcript.length > 0;
    const isToday = date === localDateKey();
    return (
      <div className="fade-up flex flex-1 flex-col items-center justify-center gap-5 px-8 pb-8 pt-20 text-center">
        <p className="max-w-sm font-serif text-[17px] leading-relaxed text-ink-soft">
          {talked
            ? `No entry yet. Ember can write it from ${isToday ? "today's" : "this"} conversation, and you can change anything after.`
            : "No entry yet. Talk it through first for a fuller entry, or let Ember write one from your notes and check-in."}
        </p>
        <button onClick={onRequestWrite} className="btn-primary">
          {talked ? "Write the entry" : "Write it from my notes"}
        </button>
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-5">
      <EntryFields
        date={date}
        paper={paper}
        onPaperChange={handlePaper}
        draft={draft}
        onChange={(d) => {
          setDraft(d);
          setUserEdited(true);
          setWrittenByEmber(false);
        }}
        onSave={handleSave}
        saveLabel={savedAt ? "Save changes" : "Save entry"}
        savedAt={writtenByEmber ? null : savedAt}
        banner={
          phase === "fallback" && errorMessage ? (
            <div className="rounded-lg bg-ember-wash/70 px-4 py-3 text-[14px] leading-relaxed text-ember-deep">
              Ember couldn&rsquo;t write a clean entry ({errorMessage}). This is a rough page made from your notes,
              and it isn&rsquo;t saved yet. Edit it and save, or try Rewrite.
            </div>
          ) : confirmOverwrite ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ember-wash/70 px-4 py-2.5 text-[14px] text-ember-deep">
              <span>You edited this entry yourself. Rewrite it from the whole conversation anyway?</span>
              <button onClick={() => runGeneration()} className="btn-subtle bg-sheet">
                Rewrite
              </button>
              <button onClick={() => setConfirmOverwrite(false)} className="btn-ghost">
                Keep mine
              </button>
            </div>
          ) : writtenByEmber ? (
            <p className="fade-up text-[13px] text-ink-faint">Written and saved by Ember. Tap anywhere on the page to change it.</p>
          ) : undefined
        }
        extraActions={
          !showFeedback ? (
            <button onClick={() => setShowFeedback(true)} className="btn-subtle">
              Rewrite
            </button>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input w-full"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What should change? (optional)"
                />
                {/* Regenerating a user-edited entry needs confirmation */}
                {userEdited && !confirmDiscard ? (
                  <button onClick={() => setConfirmDiscard(true)} className="btn-subtle">
                    Rewrite
                  </button>
                ) : (
                  <button onClick={handleRegenerate} className="btn-subtle">
                    Rewrite
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowFeedback(false);
                    setConfirmDiscard(false);
                  }}
                  className="btn-ghost"
                >
                  Cancel
                </button>
              </div>
              {userEdited && confirmDiscard && (
                <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-ember-deep">
                  <span>This replaces your own edits. Go ahead?</span>
                  <button onClick={handleRegenerate} className="btn-subtle">
                    Yes, rewrite
                  </button>
                  <button onClick={() => setConfirmDiscard(false)} className="btn-ghost">
                    Keep my edits
                  </button>
                </div>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
