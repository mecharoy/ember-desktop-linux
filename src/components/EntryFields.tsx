import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSetting } from "../db/settings";
import { DEFAULT_PAPER, PAPERS, paperById, paperStyle } from "./paper";

export interface EntryDraft {
  title: string;
  narrative: string;
  highlights: string[];
  counselorNote: string;
}

interface EntryFieldsProps {
  /** The day the page is for, written at its top. */
  date: string;
  draft: EntryDraft;
  onChange: (draft: EntryDraft) => void;
  /** Paper id for this entry; null uses the default from Settings. */
  paper: string | null;
  onPaperChange: (paper: string) => void;
  onSave: () => void;
  saveLabel?: string;
  savedAt?: number | null;
  extraActions?: React.ReactNode;
  banner?: React.ReactNode;
}

/** Must match --line in index.css: every line of the page is this tall. */
const RULE = 34;

/** A textarea that grows a whole ruled line at a time, so the writing always
 * sits on the lines and the page never scrolls inside itself. Refits when
 * its width changes too: a page that was hidden measures zero until shown. */
function GrowingText({
  value,
  onChange,
  className,
  minLines,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  minLines: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      const lines = Math.max(Math.ceil(el.scrollHeight / RULE), minLines);
      el.style.height = `${lines * RULE}px`;
    };
    fit();
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, minLines]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`hand hand-field ${className}`}
    />
  );
}

/** One blank ruled line. */
const Skip = () => <div aria-hidden="true" style={{ height: RULE }} />;

function handDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PaperPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[13px] text-fg-faint">Paper</span>
      <div className="-my-1 flex flex-1 gap-2.5 overflow-x-auto py-1" role="radiogroup" aria-label="Paper colour">
        {PAPERS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={value === p.id}
            aria-label={p.label}
            onClick={() => onChange(p.id)}
            className={`h-8 w-8 shrink-0 rounded-full border transition-transform duration-150 active:scale-90 ${
              value === p.id ? "border-transparent ring-2 ring-moss ring-offset-2 ring-offset-ground" : "border-line-strong"
            }`}
            style={{ background: `linear-gradient(to bottom, ${p.bg} 58%, ${p.line} 58%, ${p.line} 62%, ${p.bg} 62%)` }}
          />
        ))}
      </div>
    </div>
  );
}

/** The entry as a handwritten page on the paper of your choice. Shared by
 * tonight's EntryReview and the Journal tab; everything on it stays editable. */
export default function EntryFields({
  date,
  draft,
  onChange,
  paper,
  onPaperChange,
  onSave,
  saveLabel = "Save",
  savedAt,
  extraActions,
  banner,
}: EntryFieldsProps) {
  const [defaultPaper, setDefaultPaper] = useState(DEFAULT_PAPER);

  useEffect(() => {
    getSetting("journal_paper")
      .then((v) => setDefaultPaper(paperById(v).id))
      .catch(() => {});
  }, []);

  const paperId = paperById(paper ?? defaultPaper).id;

  function update<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <div className="flex flex-col gap-5">
      {banner}

      <PaperPicker value={paperId} onChange={onPaperChange} />

      <article className="paper-sheet selectable transition-colors duration-300" style={paperStyle(paperId)}>
        <span className="paper-tape" aria-hidden="true" />
        <p className="hand text-right text-[20px]" style={{ color: "var(--paper-soft)" }}>
          {handDate(date)}
        </p>
        <input
          className="hand hand-field hand-title"
          value={draft.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="Give the day a title"
          aria-label="Title"
        />
        <Skip />

        <span className="hand-label">The day</span>
        <GrowingText minLines={4} value={draft.narrative} onChange={(v) => update("narrative", v)} className="" />
        <Skip />

        <span className="hand-label">What stood out</span>
        <ul>
          {draft.highlights.map((h, i) => (
            <li key={i} className="flex items-start">
              <span className="hand w-5 shrink-0 select-none" style={{ height: RULE }} aria-hidden="true">
                &bull;
              </span>
              {/* Wraps onto the next ruled line instead of scrolling sideways. */}
              <GrowingText
                minLines={1}
                value={h}
                onChange={(v) => {
                  const next = draft.highlights.slice();
                  next[i] = v.replace(/\n/g, " ");
                  update("highlights", next);
                }}
                className="min-w-0 flex-1"
              />
              <button
                onClick={() => update("highlights", draft.highlights.filter((_, idx) => idx !== i))}
                className="hand w-8 shrink-0 text-center opacity-50 active:opacity-100"
                style={{ height: RULE }}
                aria-label="Remove this line"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => update("highlights", [...draft.highlights, ""])}
          className="hand block text-left opacity-60 active:opacity-100"
          style={{ height: RULE, fontSize: 20 }}
        >
          + add a line
        </button>
        <Skip />

        <span className="hand-label">A note from Elytra</span>
        <GrowingText
          minLines={2}
          value={draft.counselorNote}
          onChange={(v) => update("counselorNote", v)}
          className=""
        />
      </article>

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button onClick={onSave} className="btn-primary">
          {saveLabel}
        </button>
        {extraActions}
        {savedAt && <span className="fade-up text-[13px] text-fg-faint">Saved</span>}
      </div>
    </div>
  );
}
