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
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12.5px] text-ink-faint">{label}</span>
      <span className="flex items-baseline gap-2 font-serif text-[30px] leading-none tracking-[-0.01em] text-ink">
        {value}
        {delta !== undefined && delta !== null && Math.abs(delta) >= 0.05 && (
          <span
            className="font-sans text-[12px] tabular-nums"
            style={{ color: delta > 0 ? CHROME.deltaUp : CHROME.muted }}
            title="Compared with the 7 days before"
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </span>
      {note && <span className="text-[11px] leading-snug text-ink-faint">{note}</span>}
    </div>
  );
}

/** "from 2 days" — an average is only as good as the days behind it. The
 * arrow needs MIN_DAYS_FOR_DELTA days in both weeks, so say when it's held back. */
function daysNote(days: number, delta: number | null): string | undefined {
  if (days === 0) return undefined;
  const base = `from ${days} day${days === 1 ? "" : "s"}`;
  return delta === null ? `${base} · a trend needs ${MIN_DAYS_FOR_DELTA}+ days in each week` : base;
}

export default function VitalsRow({ vitals, streak }: { vitals: Vitals; streak: number }) {
  const fmt = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  return (
    <div className="fade-up grid grid-cols-2 gap-x-5 gap-y-5 border-t border-rule pt-5">
      <Tile label="Days in a row" value={streak > 0 ? String(streak) : "–"} />
      <Tile label="Entries this month" value={String(vitals.entriesThisMonth)} />
      <Tile
        label="Mood, last 7 days"
        value={fmt(vitals.avgMood7)}
        delta={vitals.moodDelta}
        note={daysNote(vitals.moodDays7, vitals.moodDelta)}
      />
      <Tile
        label="Energy, last 7 days"
        value={fmt(vitals.avgEnergy7)}
        delta={vitals.energyDelta}
        note={daysNote(vitals.energyDays7, vitals.energyDelta)}
      />
      <Tile label="Notes this week" value={String(vitals.capturesThisWeek)} />
    </div>
  );
}
