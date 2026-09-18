import { useState } from "react";
import {
  daysBetween,
  discoveredHabits,
  habitDetail,
  habitMonthCells,
  type DayRow,
  type HabitDayState,
} from "../../insights/stats";
import type { HabitPref, Observation } from "../../db/types";
import { linksForHabit, type Patterns } from "../../ai/patterns";
import { ModuleCard } from "./ModuleCard";
import { CHROME, EMBER_RAMP, HABIT_LESS } from "./palette";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const canon = (k: string) => k.trim().toLowerCase();

/** How each kind of day is drawn on the paper. */
const CELL = {
  doneText: CHROME.surface,
  skipped: { boxShadow: `inset 0 0 0 1.5px ${CHROME.muted}`, color: "#564e45" },
  unmentioned: { background: CHROME.emptyCell, color: CHROME.muted },
  noEntry: { boxShadow: "inset 0 0 0 1px #ddd3c1", color: "#a0968a" },
  future: { color: "#c7baa3" },
} as const;

function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function stateText(state: HabitDayState, less: boolean): string {
  switch (state) {
    case "done":
      return less ? "did it" : "done";
    case "skipped":
      return less ? "said you didn't" : "said you skipped it";
    case "unmentioned":
      return "journaled, didn't come up";
    case "no-entry":
      return "no journal that day";
    default:
      return "";
  }
}

/** One calendar month for one habit. */
function MonthHeatMap({ cells, less }: { cells: ReturnType<typeof habitMonthCells>; less: boolean }) {
  const doneColor = less ? HABIT_LESS : EMBER_RAMP[3];
  return (
    <div className="grid w-fit grid-cols-7 gap-1 text-center text-[10.5px] tabular-nums">
      {WEEKDAY_LABELS.map((d, i) => (
        <span key={i} className="text-ink-faint">
          {d}
        </span>
      ))}
      {cells.map((c, i) => {
        if (!c) return <span key={`blank-${i}`} />;
        const style: React.CSSProperties =
          c.state === "done"
            ? { background: doneColor, color: CELL.doneText }
            : c.state === "skipped"
              ? CELL.skipped
              : c.state === "unmentioned"
                ? CELL.unmentioned
                : c.state === "no-entry"
                  ? CELL.noEntry
                  : CELL.future;
        return (
          <span
            key={c.date}
            title={c.state === "future" ? c.date : `${c.date}: ${stateText(c.state, less)}`}
            className="flex h-6 w-6 items-center justify-center rounded-[5px]"
            style={style}
          >
            {c.day}
          </span>
        );
      })}
    </div>
  );
}

/** What the squares mean. The filled colour depends on the habit's goal, so
 *  both are explained whenever both kinds are pinned. */
function Legend({ anyMore, anyLess }: { anyMore: boolean; anyLess: boolean }) {
  const swatch = (style: React.CSSProperties) => <span className="inline-block h-3 w-3 shrink-0 rounded-[3px]" style={style} />;
  const item = (style: React.CSSProperties, text: string) => (
    <span className="flex items-center gap-1.5">
      {swatch(style)}
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-soft">
      {anyMore && item({ background: EMBER_RAMP[3] }, "done (a habit you're building)")}
      {anyLess && item({ background: HABIT_LESS }, "did it (a habit you're cutting back)")}
      {item({ boxShadow: CELL.skipped.boxShadow }, "you said you didn't")}
      {item({ background: CELL.unmentioned.background }, "journaled, didn't come up")}
      {item({ boxShadow: CELL.noEntry.boxShadow }, "no journal that day")}
    </div>
  );
}

export default function HabitsModule({
  rows,
  todayKey,
  journaledDates,
  habitObservations,
  habitPrefs,
  patterns,
  patternsState,
  onFindPatterns,
  onPin,
  onPinDiscovered,
  onDismiss,
  onDescribe,
  onDirection,
}: {
  rows: DayRow[];
  todayKey: string;
  journaledDates: Set<string>;
  habitObservations: Observation[]; // kind='habit'
  habitPrefs: HabitPref[];
  /** What each habit goes with, read by the model (ai/patterns.ts). */
  patterns: Patterns | null;
  patternsState: { busy: boolean; message: string | null };
  onFindPatterns: () => void;
  onPin: (obs: Observation, pinned: boolean) => void;
  onPinDiscovered: (key: string) => void;
  onDismiss: (key: string, dismissed: boolean) => void;
  onDescribe: (obs: Observation, text: string) => void;
  onDirection: (key: string, direction: "less" | null) => void;
}) {
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [showAllDiscovered, setShowAllDiscovered] = useState(false);
  // The habit whose description is being written, and what has been typed.
  const [describing, setDescribing] = useState<{ id: number; text: string } | null>(null);

  const prefByKey = new Map(habitPrefs.map((p) => [p.key, p]));
  const dismissed = new Set(habitPrefs.filter((p) => p.dismissed === 1).map((p) => p.key));
  const pinned = habitObservations.filter((o) => o.pinned === 1 && !dismissed.has(canon(o.key)));
  const pinnedKeys = new Set(pinned.map((o) => canon(o.key)));
  const discovered = discoveredHabits(rows, dismissed).filter((h) => !pinnedKeys.has(canon(h.key)));
  const visibleDiscovered = showAllDiscovered ? discovered : discovered.slice(0, 6);
  const isCurrentMonth = month >= todayKey.slice(0, 7);
  const isLess = (key: string) => prefByKey.get(canon(key))?.direction === "less";
  const anyLess = pinned.some((o) => isLess(o.key));
  const anyMore = pinned.some((o) => !isLess(o.key));

  return (
    <ModuleCard
      title="Habits"
      aside={
        pinned.length > 0 ? (
          <div className="flex items-center gap-1 text-[12.5px] text-ink-soft">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="btn-ghost px-2" aria-label="Previous month">
              &lsaquo;
            </button>
            <span className="w-32 text-center font-serif text-[15px] text-ink">{monthLabel(month)}</span>
            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={isCurrentMonth}
              className="btn-ghost px-2"
              aria-label="Next month"
            >
              &rsaquo;
            </button>
          </div>
        ) : undefined
      }
    >
      {pinned.length === 0 && <p className="hint mb-4 max-w-xl">Pin one to track it day by day.</p>}

      {pinned.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <Legend anyMore={anyMore} anyLess={anyLess} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={onFindPatterns} disabled={patternsState.busy} className="btn-chip">
              {patternsState.busy ? "Reading your days…" : patterns ? "Look for links again" : "Find what each habit goes with"}
            </button>
            {patternsState.message && <span className="text-[12.5px] text-ink-faint">{patternsState.message}</span>}
          </div>
        </div>
      )}

      <div className="flex flex-col divide-y divide-rule">
        {pinned.map((obs) => {
          const less = isLess(obs.key);
          const d = habitDetail(rows, obs.key, todayKey);
          const cells = habitMonthCells(d, journaledDates, month, todayKey);
          const inMonth = cells.filter((c) => c && c.state !== "future" && c.state !== "no-entry");
          const doneInMonth = inMonth.filter((c) => c!.state === "done").length;
          const sinceLast = d.lastDone ? daysBetween(d.lastDone, todayKey) : null;
          const links = linksForHabit(patterns, obs.key);
          return (
            <div key={obs.id} className="flex flex-col gap-4 py-5 first:pt-0 md:flex-row md:gap-8">
              <div className="flex shrink-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-serif text-[17px] text-ink">{obs.key}</span>
                  <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
                    Goal
                    <div className="flex gap-0.5 rounded-md border border-rule p-0.5" role="group" aria-label={`Goal for ${obs.key}`}>
                      {([false, true] as const).map((wantLess) => (
                        <button
                          key={String(wantLess)}
                          onClick={() => onDirection(obs.key, wantLess ? "less" : null)}
                          aria-pressed={wantLess === less}
                          className="seg px-2 py-1 text-[12px]"
                          title={wantLess ? "Something you want to do less of" : "Something you want to do more of"}
                        >
                          {wantLess ? "cut back" : "build up"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {describing?.id === obs.id ? (
                  <div className="flex max-w-xs flex-col gap-2">
                    <textarea
                      autoFocus
                      rows={2}
                      className="input min-h-[52px] py-1 text-[14px] leading-snug"
                      aria-label={`Description of ${obs.key}`}
                      value={describing.text}
                      onChange={(e) => setDescribing({ id: obs.id, text: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          onDescribe(obs, describing.text);
                          setDescribing(null);
                        }}
                        className="btn-chip"
                      >
                        Save
                      </button>
                      <button onClick={() => setDescribing(null)} className="btn-ghost min-h-[30px] py-1 text-[12.5px]">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : obs.detail ? (
                  <p className="max-w-xs text-[12.5px] leading-snug text-ink-faint">
                    {obs.detail}{" "}
                    <button onClick={() => setDescribing({ id: obs.id, text: obs.detail ?? "" })} className="underline decoration-rule-strong underline-offset-2">
                      Edit
                    </button>
                  </p>
                ) : (
                  <button onClick={() => setDescribing({ id: obs.id, text: "" })} className="self-start text-[12.5px] text-ink-faint underline decoration-rule-strong underline-offset-2">
                    Add a description
                  </button>
                )}
                <MonthHeatMap cells={cells} less={less} />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
                  {less ? (
                    <span>
                      Last did it: {sinceLast === null ? "not recorded yet" : sinceLast === 0 ? "today" : `${sinceLast} days ago`}
                    </span>
                  ) : (
                    <span>
                      In a row: {d.currentStreak} {d.currentStreak === 1 ? "day" : "days"}
                    </span>
                  )}
                  <span>
                    This month: {doneInMonth} of {inMonth.length} journaled day{inMonth.length === 1 ? "" : "s"}
                  </span>
                </div>

                {d.effect && (
                  <p className="text-[13px] leading-snug text-ink-soft">
                    Mood on days with it: {d.effect.withAvg.toFixed(1)}, without: {d.effect.withoutAvg.toFixed(1)} (
                    {d.effect.nWith} and {d.effect.nWithout} days).
                  </p>
                )}

                <div className="flex flex-col gap-1.5">
                  <span className="font-serif text-[14px] italic text-ink-faint">Goes with</span>
                  {links.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {links.map((l) => (
                        <li key={l.linked_to} className="text-[13.5px] leading-snug">
                          <span className="text-ink">{l.linked_to}</span>
                          <span className="block text-[12.5px] text-ink-faint">{l.how}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-ink-faint">
                      {patterns ? "No clear link in your recent days." : "Not looked for yet."}
                    </p>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <button onClick={() => onPin(obs, false)} className="btn-chip">
                    Unpin
                  </button>
                  <button
                    onClick={() => {
                      onPin(obs, false);
                      onDismiss(obs.key, true);
                    }}
                    className="btn-chip danger"
                    title="Stop tracking this and never count it as a habit"
                  >
                    Not a habit
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {discovered.length > 0 && (
        <div className="mt-5">
          <p className="hint mb-2">Spotted in your entries. Pin one to track it, or &times; if it isn&rsquo;t a habit.</p>
          <ul className="flex flex-wrap gap-1.5">
            {visibleDiscovered.map((h) => (
              <li key={h.key} className="flex items-center overflow-hidden rounded-full border border-rule-strong text-[12.5px]">
                <button
                  onClick={() => onPinDiscovered(h.key)}
                  className="py-1 pl-3 pr-1.5 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                  title="Pin this habit"
                >
                  + {h.key} <span className="tabular-nums text-ink-faint">{h.count}&times;</span>
                </button>
                <button
                  onClick={() => onDismiss(h.key, true)}
                  className="border-l border-rule px-2 py-1 text-ink-faint transition-colors hover:bg-danger-wash hover:text-danger"
                  aria-label={`${h.key} is not a habit`}
                  title="Not a habit. Hide it and stop counting it."
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
          {discovered.length > 6 && (
            <button onClick={() => setShowAllDiscovered((v) => !v)} className="btn-ghost -ml-2.5 mt-1.5">
              {showAllDiscovered ? "Show fewer" : `Show all ${discovered.length}`}
            </button>
          )}
        </div>
      )}

      {dismissed.size > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          <span className="text-[12.5px] text-ink-faint">Not habits</span>
          <ul className="flex flex-wrap gap-2">
            {Array.from(dismissed).map((k) => (
              <li key={k} className="flex items-center gap-2 text-[13px] text-ink-soft">
                {k}
                <button
                  onClick={() => {
                    setShowAllDiscovered(true); // so it shows even past the first six
                    onDismiss(k, false);
                  }}
                  className="btn-chip min-h-[26px] px-2.5 py-0.5 text-[12px]"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pinned.length === 0 && discovered.length === 0 && dismissed.size === 0 && (
        <p className="hint">No habits found yet. They show up as your entries are read.</p>
      )}
    </ModuleCard>
  );
}
