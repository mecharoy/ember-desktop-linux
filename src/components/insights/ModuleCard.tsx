import { useEffect, useRef, useState, type ReactNode } from "react";
import { SCIENCE, UNLOCK } from "../../insights/science";

/** Section titles (open and locked) → their entry in insights/science.ts. */
const SCIENCE_BY_TITLE: Record<string, string> = {
  "Mood & energy": "mood",
  "Mood & energy over time": "mood",
  "Week rhythm": "rhythm",
  Themes: "themes",
  People: "people",
  Habits: "habits",
  "What moves your mood": "movers",
  "Emotional vocabulary": "emotions",
  "Wellbeing checks": "wellbeing",
  Sleep: "sleep",
  "Daily routine": "routine",
  "Activities & mood": "activities",
  "Thinking patterns": "thinking",
  Reviews: "reviews",
};

/** The ⓘ next to a section title and the note it opens: how to read the
 *  section and the study behind it. The note spans the section's width. */
function useInfo(title: string) {
  const id = SCIENCE_BY_TITLE[title] ?? "";
  const science = SCIENCE[id];
  const unlock = UNLOCK[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const button = science ? (
    <button
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={`About ${title}`}
      className={`ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-serif text-[13px] italic leading-none transition-colors duration-150 ${
        open ? "border-ember bg-ember text-paper" : "border-rule-strong text-ink-faint"
      }`}
    >
      i
    </button>
  ) : null;

  const note =
    science && open ? (
      <div
        role="dialog"
        className="fade-up absolute inset-x-0 top-full z-30 mt-2 flex flex-col gap-2 rounded-xl border border-rule bg-sheet p-4 shadow-[0_12px_32px_-12px_rgba(40,35,30,0.35)]"
      >
        <p className="text-[14px] leading-relaxed text-ink">{science.read}</p>
        <p className="text-[13.5px] leading-relaxed text-ink-soft">{science.basis}</p>
        {science.caution && <p className="text-[13.5px] leading-relaxed text-ink-soft">{science.caution}</p>}
        {unlock && <p className="text-[13.5px] font-medium leading-relaxed text-ember">{unlock}</p>}
        <p className="border-t border-rule pt-2 font-serif text-[13px] italic leading-snug text-ink-faint">{science.source}</p>
      </div>
    ) : null;

  return { ref, button, note };
}

/** Shared chrome for an Insights section: a rule above, a serif title, no box. */
export function ModuleCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const info = useInfo(title);
  return (
    <section className="fade-up border-t border-rule pt-5">
      <div ref={info.ref} className="relative mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="section-title flex items-center">
          {title}
          {info.button}
        </h2>
        {aside}
        {info.note}
      </div>
      {children}
    </section>
  );
}

/** A section still gathering days: what it will show, and how far along it is. */
export function LockedModule({
  title,
  teaser,
  have,
  need,
}: {
  title: string;
  teaser: string;
  have?: number;
  need?: number;
}) {
  const counted = have !== undefined && need !== undefined;
  const pct = counted ? Math.min(100, Math.round((have / need) * 100)) : 0;
  const info = useInfo(title);
  return (
    <section className="border-t border-dashed border-rule-strong pt-5">
      <div ref={info.ref} className="relative flex items-center justify-between gap-3">
        {info.note}
        <h2 className="flex items-center font-serif text-[19px] leading-snug text-ink-faint">
          {title}
          {info.button}
        </h2>
        {counted && (
          <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">
            {Math.min(have, need)}/{need}
          </span>
        )}
      </div>
      <p className="mt-1 font-serif text-[15.5px] italic leading-snug text-ink-soft">{teaser}</p>
      {counted && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-paper-deep" aria-hidden="true">
          <div className="h-full rounded-full bg-ember/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </section>
  );
}
