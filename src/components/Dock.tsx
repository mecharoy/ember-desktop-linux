import { useCallback, useEffect, useRef, useState } from "react";
import Beetle from "../mascot/Beetle";
import { claim, release } from "../mascot/pulse";
import { companionLine, readDay } from "../mascot/companion";

/**
 * The dock — the whole of the app's navigation, on every window size and on
 * both platforms. There is no sidebar any more: a cabinet has one set of
 * handles along its front, not a list down its side.
 *
 * The bar holds the four plates, a seam, and the note button. The beetle is
 * NOT in the bar: it has a perch of its own (Perch, below), big enough that
 * its expressions can be seen — beside the bar on a phone, in the bottom-left
 * corner of a wide window. It is the app's one visible sign of life
 * (mascot/pulse.ts).
 *
 * Only the plate you are on says its name, and the name parts open downward
 * when you arrive. Every plate is the same width either way, so pressing one
 * never moves the others out from under your finger.
 *
 * This file is the same in elytra-desktop and elytra-mobile: change both.
 */

export const TABS = [
  { id: "today", label: "Today" },
  { id: "journal", label: "Journal" },
  { id: "insights", label: "Patterns" },
  { id: "settings", label: "Settings" },
];

/**
 * Four plates from a field guide: one stroke weight, no fills except a
 * specimen, nothing that isn't drawn.
 *
 * Today is the wing cases parted — the day that is still open. Journal is the
 * stack of cards those days become. Patterns is the drawer they are sorted
 * into. Settings is two rules with pin heads for handles.
 *
 * Every one of these was drawn at 21px and looked at before it was kept,
 * because that is the only size they ship at and shapes lie at large sizes.
 * Three earlier drawings died there: dividers and every dial read as a POWER
 * button (a circle with a stem on top always does), and a card impaled on a
 * pin turned to mush. If you redraw one, render it at 21px first.
 */
export function NavIcon({ id }: { id: string }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "today": // the wing cases, parted at the seam — the day still open
      return (
        <svg {...common}>
          <path d="M9.5 6.6c0-2.3 1.1-3.5 2.5-3.5s2.5 1.2 2.5 3.5z" />
          <path d="M11.2 7.3C7.6 7.6 4.6 9.8 4.6 13c0 3.8 2.9 6.7 5.7 7.4z" />
          <path d="M12.8 7.3c3.6.3 6.6 2.5 6.6 5.7 0 3.8-2.9 6.7-5.7 7.4z" />
        </svg>
      );
    case "journal": // the stack of cards the days become
      return (
        <svg {...common}>
          <rect x="7.2" y="3.6" width="12.4" height="9" rx="1.5" />
          <rect x="4.4" y="10.4" width="12.4" height="9.6" rx="1.5" />
          <path d="M7.6 14.2h6M7.6 16.8h3.6" />
        </svg>
      );
    case "insights": // the specimen drawer: four compartments, three filled
      return (
        <svg {...common}>
          <rect x="3.6" y="5.2" width="16.8" height="13.6" rx="1.8" />
          <path d="M12 5.2v13.6M3.6 12h16.8" />
          <circle cx="7.8" cy="8.6" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="16.2" cy="8.6" r="0.95" fill="currentColor" stroke="none" />
          <circle cx="7.8" cy="15.4" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      );
    default: // two rules, pin heads for handles — set by hand
      return (
        <svg {...common}>
          <path d="M4.4 8.6h15.2M4.4 15.4h15.2" />
          <circle cx="9" cy="8.6" r="2.3" />
          <circle cx="15.4" cy="15.4" r="2.3" />
        </svg>
      );
  }
}

interface DockProps {
  active: string;
  onSelect: (tab: string) => void;
  onQuickNote: () => void;
  /** Desktop only: the capture hotkey, named on the note button. */
  hint?: string;
  /** Desktop only: what the phone link is doing. The beetle carries it. */
  status?: string;
}

export default function Dock({ active, onSelect, onQuickNote, hint, status }: DockProps) {
  return (
    <div
      className="relative z-30 flex shrink-0 items-center justify-center gap-2 px-3"
      style={{ height: "var(--nav-h)" }}
    >
      <Perch active={active} onSelect={onSelect} status={status} />
      <nav className="dock" aria-label="Sections">

        <ul className="flex min-w-0 flex-1 items-stretch justify-center gap-0.5">
          {TABS.map((tab) => {
            const on = active === tab.id;
            return (
              <li key={tab.id} className="flex">
                <button
                  onClick={() => onSelect(tab.id)}
                  aria-current={on ? "page" : undefined}
                  className={`dock-tab${on ? " on" : ""}`}
                >
                  <NavIcon id={tab.id} />
                  <span className="dock-label">{tab.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <span className="dock-seam" aria-hidden="true" />
        <button
          onClick={onQuickNote}
          className="dock-end dock-note"
          aria-label="Note something"
          title={hint ? `Note something — ${hint}` : "Note something"}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 6v12M6 12h12" />
          </svg>
        </button>
      </nav>
    </div>
  );
}

/**
 * The beetle's own place. Tap it and it says where the day has got to — read
 * straight out of the database, so there is nothing to wait for — with one
 * finding from Patterns under that. Tapping again, Escape, or a click
 * anywhere else puts the card away.
 */
function Perch({ active, onSelect, status }: { active: string; onSelect: (tab: string) => void; status?: string }) {
  const [said, setSaid] = useState<{ line: string; insight: string | null } | null>(null);
  const companionRef = useRef<HTMLDivElement>(null);

  const hush = useCallback(() => setSaid(null), []);

  async function ask() {
    if (said !== null) {
      hush();
      return;
    }
    const day = await readDay();
    setSaid({ line: companionLine(day), insight: day.insight });
  }

  // Changing page puts it away. Without this it hangs over the next page,
  // still describing the moment you tapped it.
  useEffect(hush, [active, hush]);

  useEffect(() => {
    if (said === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hush();
    };
    const onDown = (e: PointerEvent) => {
      if (!companionRef.current?.contains(e.target as Node)) hush();
    };
    window.addEventListener("keydown", onKey);
    // Capture, so it closes before the click lands on whatever is underneath.
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [said, hush]);

  return (
    <div ref={companionRef} className="perch">
      {said !== null && (
        <div className="companion-card" role="status">
          <p className="text-fg">{said.line}</p>
          {said.insight && (
            <div className="mt-2.5 border-t border-line-strong pt-2.5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-moss">From Patterns</p>
              <p className="mt-1">{said.insight}</p>
              {active !== "insights" && (
                <button
                  onClick={() => {
                    hush();
                    onSelect("insights");
                  }}
                  className="mt-1.5 text-[13px] text-moss underline underline-offset-2"
                >
                  See Patterns
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <button
        onClick={ask}
        /* Hovering is a claim like any other work, so a thinking model
           still outranks it (mascot/pulse.ts) and the beetle does not
           stop mid-thought to notice your cursor. */
        onPointerEnter={() => claim("hover", "listening")}
        onPointerLeave={() => release("hover")}
        className="perch-beetle"
        aria-expanded={said !== null}
        aria-label="How today is going"
        title={status ?? undefined}
      >
        {/* One beetle; its size is set by .perch-art for the width it is on. */}
        <Beetle size={72} className="perch-art" />
      </button>
    </div>
  );
}
