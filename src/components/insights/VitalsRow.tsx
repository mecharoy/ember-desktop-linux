import type { Vitals } from "../../insights/stats";
import { MIN_DAYS_FOR_DELTA } from "../../insights/stats";
import { CHROME } from "./palette";

function Tile({
  label,
  value,
  delta,
  note,
}: {
  label: string;
  value: string;
  delta?: number | null;
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <span className="flex items-baseline gap-2 font-serif text-[34px] leading-none tracking-[-0.015em] text-fg">
        {value}
        {delta !== undefined && delta !== null && Math.abs(delta) >= 0.05 && (
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: delta > 0 ? CHROME.deltaUp : CHROME.muted }}
            title="Compared with the 7 days before"
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </span>
      <span className="spec mt-2.5">{label}</span>
      {note && <span className="mt-1.5 text-[11px] leading-snug text-fg-faint">{note}</span>}
    </div>
  );
}

/** "from 2 days" — an average is only as good as the days behind it. The
 * arrow needs MIN_DAYS_FOR_DELTA days in both weeks, so say when it's held back. */
function daysNote(days: number, delta: number | null): string | undefined {
  if (days === 0) return undefined;
  const base = `past week, ${days} day${days === 1 ? "" : "s"} rated`;
  return delta === null ? `${base} · a trend needs ${MIN_DAYS_FOR_DELTA}+ days in each week` : base;
}

/**
 * Three numbers, not five: how the last week felt, and how long the run is.
 * The two counts (entries, notes) are context, so they sit under the tiles as
 * one line instead of competing with them at the same size.
 */
export default function VitalsRow({ vitals, streak }: { vitals: Vitals; streak: number }) {
  const fmt = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  return (
    <div className="fade-up flex flex-col gap-2.5">
      <div className="grid grid-cols-3 gap-3">
        <Tile
          label="Mood"
          value={fmt(vitals.avgMood7)}
          delta={vitals.moodDelta}
          note={daysNote(vitals.moodDays7, vitals.moodDelta)}
        />
        <Tile
          label="Energy"
          value={fmt(vitals.avgEnergy7)}
          delta={vitals.energyDelta}
          note={daysNote(vitals.energyDays7, vitals.energyDelta)}
        />
        <Tile label="Day streak" value={streak > 0 ? String(streak) : "–"} />
      </div>
      <p className="px-1 text-[13px] text-fg-faint">
        {vitals.entriesThisMonth} entr{vitals.entriesThisMonth === 1 ? "y" : "ies"} this month ·{" "}
        {vitals.capturesThisWeek} note{vitals.capturesThisWeek === 1 ? "" : "s"} this week
      </p>
    </div>
  );
}
