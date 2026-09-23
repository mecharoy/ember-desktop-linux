import type { DayRow } from "../../insights/stats";
import { sleepSummary, SLEEP_WINDOW_DAYS, type DiaryRow, type SleepFinding } from "../../insights/sleep";
import { ModuleCard } from "./ModuleCard";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-[110px] flex-col gap-1">
      <span className="text-[12px] text-fg-faint">{label}</span>
      <span className="font-serif text-[22px] leading-none text-fg">{value}</span>
      {note && <span className="text-[11px] text-fg-faint">{note}</span>}
    </div>
  );
}

/** The sleep diary, the way insomnia therapy (CBT-I) reads it. */
export default function SleepModule({
  diary,
  rows,
  todayKey,
  onOpen,
}: {
  diary: DiaryRow[];
  rows: DayRow[];
  todayKey: string;
  onOpen: (finding: SleepFinding) => void;
}) {
  const s = sleepSummary(diary, rows, todayKey);
  const mins = (v: number | null) => (v === null ? null : `±${Math.round(v)} min`);

  return (
    <ModuleCard title="Sleep" aside={<span className="text-[12px] text-fg-faint">last {SLEEP_WINDOW_DAYS} days · {s.nights} nights noted</span>}>
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <Stat label="Usual bedtime" value={s.usualBed ?? "–"} note={mins(s.bedSpreadMin) ?? undefined} />
        <Stat label="Usual time up" value={s.usualWake ?? "–"} note={mins(s.wakeSpreadMin) ?? undefined} />
        <Stat label="Asleep" value={s.avgAsleepH === null ? "–" : `${s.avgAsleepH.toFixed(1)} h`} />
        <Stat label="To fall asleep" value={s.avgLatencyMin === null ? "–" : `${Math.round(s.avgLatencyMin)} min`} />
        <Stat label="Quality" value={s.avgQuality === null ? "–" : `${s.avgQuality.toFixed(1)} / 5`} />
        <Stat
          label="Asleep in bed"
          value={s.avgEfficiency === null ? "–" : `${Math.round(s.avgEfficiency * 100)}%`}
          note="aim: 85%+"
        />
      </div>
      {s.findings.length > 0 && (
        <ul className="-mx-2 mt-4 flex flex-col">
          {s.findings.map((f) => (
            <li key={f.sentence}>
              <button
                onClick={() => onOpen(f)}
                className="w-full rounded-md px-2 py-2 text-left font-serif text-[16px] leading-snug text-fg transition-colors hover:bg-surface-high"
                title="Open the entries behind this"
              >
                {f.sentence}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}
