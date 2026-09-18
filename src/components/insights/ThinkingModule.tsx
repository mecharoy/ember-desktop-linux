import type { DayRow } from "../../insights/stats";
import { thinkingTrapStats } from "../../insights/thinking";
import { ModuleCard } from "./ModuleCard";
import { shortDate } from "../../insights/format";

/** The thinking traps CBT teaches people to spot, in their own words. */
export default function ThinkingModule({
  rows,
  todayKey,
  onOpen,
}: {
  rows: DayRow[];
  todayKey: string;
  onOpen: (label: string, dates: string[]) => void;
}) {
  const stats = thinkingTrapStats(rows, todayKey);

  return (
    <ModuleCard title="Thinking patterns">
      {stats.length === 0 ? (
        <p className="hint max-w-xl">Nothing on repeat yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-rule border-y border-rule">
          {stats.map((s) => (
            <div key={s.trap.id} className="py-3">
              <button
                onClick={() => onOpen(`thinking: ${s.trap.name}`, s.dates)}
                className="flex w-full flex-wrap items-baseline justify-between gap-x-4 text-left"
                title="Open the entries behind this"
              >
                <span className="font-serif text-[17px] text-ink">{s.trap.name}</span>
                <span className="text-[12px] text-ink-faint">
                  {s.days} days · {s.recentDays} in the last 8 weeks
                  {s.themes.length > 0 ? ` · often with ${s.themes.join(", ")}` : ""}
                </span>
              </button>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">{s.trap.plain}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {s.examples.map((e) => (
                  <li key={`${e.date}-${e.quote}`}>
                    <button
                      onClick={() => onOpen(`thinking: ${s.trap.name}`, [e.date])}
                      className="text-left font-serif text-[14.5px] italic leading-snug text-ink-soft hover:text-ink"
                    >
                      &ldquo;{e.quote}&rdquo; <span className="not-italic text-[11.5px] text-ink-faint">{shortDate(e.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </ModuleCard>
  );
}
