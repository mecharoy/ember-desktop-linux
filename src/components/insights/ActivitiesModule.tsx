import { addDays, STALE_AFTER_DAYS, type DayRow } from "../../insights/stats";
import { activityStats, enjoymentPullBack } from "../../insights/activation";
import { ModuleCard } from "./ModuleCard";

/** Four small marks for a 0-3 average. */
function Dots({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-[12px] text-fg-faint">–</span>;
  const filled = Math.round(value);
  return (
    <span className="inline-flex gap-0.5" title={`${label}: ${value.toFixed(1)} of 3`} aria-label={`${label} ${value.toFixed(1)} of 3`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`h-2 w-2 rounded-full ${n <= filled ? "bg-moss" : "bg-line"}`} />
      ))}
    </span>
  );
}

/** Behavioural activation — which things lift you, and whether you're doing fewer of them. */
export default function ActivitiesModule({
  rows,
  todayKey,
  onOpen,
}: {
  rows: DayRow[];
  todayKey: string;
  onOpen: (label: string, dates: string[]) => void;
}) {
  const stats = activityStats(rows, addDays(todayKey, -STALE_AFTER_DAYS)).slice(0, 12);
  const pullBack = enjoymentPullBack(rows, todayKey);

  return (
    <ModuleCard title="Activities & mood">
      {pullBack && (
        <p className="mb-4 max-w-xl border-l-2 border-moss/60 pl-4 text-[14px] leading-relaxed text-fg">
          Fewer things you enjoy have come up lately: {pullBack.recentPerDay.toFixed(1)} a day in the last two weeks,
          against {pullBack.beforePerDay.toFixed(1)} before.
        </p>
      )}
      {stats.length === 0 ? (
        <p className="hint max-w-xl">Nothing has come up on more than one day yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] text-fg-faint">
              <th className="pb-2 font-normal">Activity</th>
              <th className="pb-2 font-normal">Days</th>
              <th className="pb-2 font-normal">Enjoyment</th>
              <th className="pb-2 font-normal">Achievement</th>
              <th className="pb-2 font-normal">Mood</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stats.map((a) => (
              <tr key={a.key} className="cursor-pointer hover:bg-surface-high" onClick={() => onOpen(`activity: ${a.key}`, a.dates)}>
                <td className="py-2 text-fg">{a.key}</td>
                <td className="py-2 tabular-nums text-fg-dim">{a.days}</td>
                <td className="py-2">
                  <Dots value={a.pleasure?.avg ?? null} label="Enjoyment" />
                </td>
                <td className="py-2">
                  <Dots value={a.mastery?.avg ?? null} label="Achievement" />
                </td>
                <td className="py-2 text-[12px] text-fg-dim">
                  {a.moodOn ? (
                    <span title={`${a.moodOn.nWith} days with it, ${a.moodOn.nWithout} without`}>
                      <span className={a.moodEffect ? "font-medium text-fg" : "text-fg"}>{a.moodOn.withAvg.toFixed(1)}</span>{" "}
                      <span className="text-fg-faint">vs {a.moodOn.withoutAvg.toFixed(1)}</span>
                    </span>
                  ) : (
                    <span className="text-fg-faint" title="Needs at least 3 journaled days with it and 3 without">
                      –
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stats.length > 0 && (
        <p className="hint mt-3">Mood: your average on days with the activity, against days without.</p>
      )}
    </ModuleCard>
  );
}
