import type { DayRow } from "../../insights/stats";
import { routineSummary, HIT_WINDOW_MIN } from "../../insights/routine";
import type { DiaryRow } from "../../insights/sleep";
import { ModuleCard } from "./ModuleCard";
import Sparkline from "./Sparkline";

/** How steady the day's anchors are, scored like the Social Rhythm Metric. */
export default function RoutineModule({
  rows,
  diary,
  todayKey,
  onOpen,
}: {
  rows: DayRow[];
  diary: DiaryRow[];
  todayKey: string;
  onOpen: (label: string, dates: string[]) => void;
}) {
  const s = routineSummary(rows, diary, todayKey);
  const scored = s.weeks.filter((w) => w.score !== null);

  return (
    <ModuleCard title="Daily routine">
      {s.latest && (
        <div className="mb-4 flex flex-wrap items-end gap-6">
          <p className="max-w-md font-serif text-[18px] leading-snug text-ink">
            Last full week, your routine held on about {Math.round(s.latest.score!)} of 7 days.
          </p>
          {scored.length >= 2 && <Sparkline values={scored.map((w) => w.score!)} width={120} height={28} />}
        </div>
      )}
      <table className="w-full text-[13.5px]">
        <tbody className="divide-y divide-rule">
          {s.anchors.map((a) => (
            <tr key={a.id}>
              <td className="py-2 pr-2 text-ink" title={`On time = within ${HIT_WINDOW_MIN} minutes of your usual`}>{a.label}</td>
              <td className="py-2 tabular-nums text-ink-soft">{a.usual ?? "–"}</td>
              <td className="py-2 text-right text-ink-faint">
                {a.days === 0 ? "not noted" : `${a.hits}/${a.days} on time`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.finding && (
        <button
          onClick={() => onOpen("steadier weeks", s.finding!.dates)}
          className="-mx-2 mt-3 w-full rounded-md px-2 py-2 text-left font-serif text-[16px] leading-snug text-ink transition-colors hover:bg-paper-deep"
        >
          {s.finding.sentence}
        </button>
      )}
    </ModuleCard>
  );
}
