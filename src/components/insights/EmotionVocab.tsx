import { useState } from "react";
import {
  addDays,
  countDaysWithNamedEmotions,
  emotionCounts,
  type DayRow,
  type EmotionSource,
} from "../../insights/stats";
import { ModuleCard } from "./ModuleCard";
import { WING_RAMP } from "./palette";

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={o.id === value} className="seg">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Horizontal bars of emotions — plain divs, direct-labeled. Defaults
 * to the feeling words the user typed themselves: the point of the module is
 * *their* vocabulary, and the AI's labels ("frustrated" for "ugh") would
 * measure the AI's instead. The labels stay one click away.
 */
export default function EmotionVocab({ rows, todayKey }: { rows: DayRow[]; todayKey: string }) {
  const [windowMode, setWindowMode] = useState<"4w" | "all">("4w");
  const [source, setSource] = useState<EmotionSource>("named");
  const counts = emotionCounts(rows, windowMode === "4w" ? addDays(todayKey, -27) : null, source).slice(0, 12);
  const max = Math.max(...counts.map((c) => c.count), 1);
  const noNamedYet = source === "named" && countDaysWithNamedEmotions(rows) === 0;

  return (
    <ModuleCard
      title="Emotional vocabulary"
      aside={
        <div className="flex items-center gap-3">
          <Toggle
            value={source}
            options={[
              { id: "named", label: "your words" },
              { id: "inferred", label: "Elytra's words" },
            ]}
            onChange={setSource}
          />
          <Toggle
            value={windowMode}
            options={[
              { id: "4w", label: "4 weeks" },
              { id: "all", label: "all time" },
            ]}
            onChange={setWindowMode}
          />
        </div>
      }
    >
      {noNamedYet ? (
        <p className="hint max-w-xl">Feeling words are kept from now on. &ldquo;Re-read all&rdquo; fills in earlier days.</p>
      ) : counts.length === 0 ? (
        <p className="hint">No feelings in this stretch yet. They build up as entries are saved.</p>
      ) : (
        <ul className="flex max-w-2xl flex-col gap-1.5">
          {counts.map((c, i) => (
            <li
              key={c.emotion}
              className="flex items-center gap-3 text-[13px]"
              title={`${c.emotion}: ${c.count} day${c.count === 1 ? "" : "s"}`}
            >
              <span className="w-28 shrink-0 truncate font-serif text-[15px] text-fg">{c.emotion}</span>
              <span className="flex flex-1 items-center gap-2">
                <span
                  className="fade-up h-2 rounded-r-[4px]"
                  style={{
                    width: `${(c.count / max) * 100}%`,
                    minWidth: 3,
                    background: WING_RAMP[2],
                    animationDelay: `${i * 30}ms`,
                  }}
                />
                <span className="tabular-nums text-fg-faint">{c.count}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint mt-3">
        {source === "named"
          ? "In your own words."
          : "As Elytra read your days."}
      </p>
    </ModuleCard>
  );
}
