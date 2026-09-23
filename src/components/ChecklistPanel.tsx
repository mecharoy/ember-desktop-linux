import { useState } from "react";
import type { AgendaItem } from "../db/types";
import Wingbeat from "./Wingbeat";

const SECTIONS: { id: AgendaItem["section"]; label: string }[] = [
  { id: "past", label: "Past" },
  { id: "today", label: "Today" },
  { id: "future", label: "Future" },
];

/**
 * Today's checklist beside the conversation: what Elytra means to cover, in
 * past / today / future. Crossing an item out tells Elytra not to bring it
 * up; Elytra ticks items off as they're talked about, and so can you.
 */
export default function ChecklistPanel({
  items,
  making,
  failed,
  onChange,
  onRemake,
  compact = false,
}: {
  items: AgendaItem[] | null;
  making: boolean;
  failed: boolean;
  onChange: (items: AgendaItem[]) => void;
  onRemake: () => void;
  /** The narrow layout: a bar above the chat that opens into the list. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<AgendaItem["section"] | null>(null);
  const [draft, setDraft] = useState("");

  const list = items ?? [];
  const left = list.filter((i) => i.state === "open").length;
  const covered = list.filter((i) => i.state === "done").length;

  function setState(id: string, state: AgendaItem["state"]) {
    onChange(list.map((i) => (i.id === id ? { ...i, state } : i)));
  }

  function add(section: AgendaItem["section"]) {
    const text = draft.trim();
    setAdding(null);
    setDraft("");
    if (!text) return;
    const prefix = section[0];
    let n = list.filter((i) => i.section === section).length + 1;
    while (list.some((i) => i.id === `${prefix}${n}`)) n++;
    onChange([...list, { id: `${prefix}${n}`, section, text, state: "open", topic: null }]);
  }

  const summary = making
    ? "Getting ready…"
    : failed && list.length === 0
      ? "Couldn't make a checklist."
      : list.length === 0
        ? "No checklist"
        : left === 0
          ? "Checklist done"
          : `${left} to talk about · ${covered} covered`;

  const body = (
    <div className="flex flex-col gap-4">
      {making && (
        <p className="flex items-center gap-2 text-[13px] text-fg-faint" role="status">
          <Wingbeat />
          Reading your notes and past entries&hellip;
        </p>
      )}
      {!making &&
        SECTIONS.map((s) => {
          const inSection = list.filter((i) => i.section === s.id);
          return (
            <section key={s.id} className="flex flex-col gap-1">
              <h3 className="spec flex items-center justify-between">
                {s.label}
                <button
                  onClick={() => {
                    setAdding(s.id);
                    setDraft("");
                  }}
                  className="rounded px-1.5 font-sans text-[16px] not-italic leading-none text-fg-faint hover:text-fg"
                  aria-label={`Add to ${s.label}`}
                  title="Add something to talk about"
                >
                  +
                </button>
              </h3>
              {inSection.length === 0 && adding !== s.id && <p className="text-[12.5px] text-fg-faint/80">Nothing here.</p>}
              <ul className="flex flex-col">
                {inSection.map((i) => (
                  <li key={i.id} className="group flex items-start gap-2 py-1">
                    <button
                      onClick={() => setState(i.id, i.state === "done" ? "open" : "done")}
                      disabled={i.state === "skip"}
                      aria-pressed={i.state === "done"}
                      aria-label={i.state === "done" ? "Mark as not covered" : "Mark as covered"}
                      className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] leading-none transition-colors ${
                        i.state === "done" ? "border-moss bg-moss text-ground" : "border-line-strong text-transparent"
                      } disabled:opacity-40`}
                    >
                      &#10003;
                    </button>
                    <span
                      className={`min-w-0 flex-1 text-[13.5px] leading-snug ${
                        i.state === "skip"
                          ? "text-fg-faint line-through"
                          : i.state === "done"
                            ? "text-fg-dim"
                            : "text-fg"
                      }`}
                    >
                      {i.text}
                    </span>
                    <button
                      onClick={() => setState(i.id, i.state === "skip" ? "open" : "skip")}
                      className="btn-chip min-h-[24px] shrink-0 px-2 py-0 text-[11.5px]"
                      title={i.state === "skip" ? "Talk about it after all" : "Don't want to talk about this"}
                    >
                      {i.state === "skip" ? "undo" : "skip"}
                    </button>
                  </li>
                ))}
              </ul>
              {adding === s.id && (
                <input
                  autoFocus
                  className="input min-h-[36px] py-1.5 text-[14px]"
                  value={draft}
                  placeholder="Something to talk about"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => add(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add(s.id);
                    if (e.key === "Escape") {
                      setAdding(null);
                      setDraft("");
                    }
                  }}
                />
              )}
            </section>
          );
        })}
      {!making && (
        <button onClick={onRemake} className="btn-ghost -ml-3 self-start text-[13px]">
          {list.length === 0 ? "Make a checklist" : "Make it again"}
        </button>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="border-b border-line/70 px-5">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between py-2 text-left text-[13px] text-fg-dim"
        >
          <span>{summary}</span>
          <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
            &rsaquo;
          </span>
        </button>
        {open && <div className="max-h-[45vh] overflow-y-auto pb-3">{body}</div>}
      </div>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line px-5 py-5" aria-label="Today's checklist">
      <div>
        <h2 className="font-serif text-[17px] text-fg">Checklist</h2>
        <p className="text-[12.5px] text-fg-faint">{summary}</p>
      </div>
      {body}
    </aside>
  );
}
