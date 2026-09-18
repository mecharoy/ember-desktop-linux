import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bestAndWorstDay, buildMoodSeries, type DayRow } from "../../insights/stats";
import { ModuleCard } from "./ModuleCard";
import { CHROME, REDUCED_MOTION, SERIES } from "./palette";

const RANGES = [
  { label: "2w", days: 14 },
  { label: "4w", days: 28 },
  { label: "12w", days: 84 },
  { label: "1y", days: 365 },
] as const;

interface TooltipPayload {
  active?: boolean;
  label?: string;
  payload?: { payload: { date: string; mood: number | null; energy: number | null; summary: string | null } }[];
}

function Swatch({ color }: { color: string }) {
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: color }} />;
}

function ChartTooltip({ active, payload }: TooltipPayload) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="max-w-60 rounded-md border border-rule bg-sheet px-3 py-2 text-[12px] shadow-[0_4px_14px_rgba(40,35,30,0.12)]">
      <div className="text-ink">{p.date}</div>
      <div className="mt-0.5 text-ink-soft">
        {p.mood !== null && (
          <span>
            <Swatch color={SERIES.mood} />
            mood {p.mood}
          </span>
        )}
        {p.mood !== null && p.energy !== null && <span className="text-ink-faint"> · </span>}
        {p.energy !== null && (
          <span>
            <Swatch color={SERIES.energy} />
            energy {p.energy}
          </span>
        )}
        {p.mood === null && p.energy === null && <span>no entry</span>}
      </div>
      {p.summary && <div className="mt-1 font-serif text-[14px] leading-snug text-ink">{p.summary}</div>}
      {p.mood !== null && <div className="mt-1 text-[11px] text-ink-faint">Tap to open the entry</div>}
    </div>
  );
}

export default function MoodEnergyChart({
  rows,
  todayKey,
  entryDates,
  onOpenEntry,
}: {
  rows: DayRow[];
  todayKey: string;
  entryDates: Set<string>;
  onOpenEntry: (date: string) => void;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const points = useMemo(() => buildMoodSeries(rows, range.days, todayKey), [rows, range, todayKey]);
  const { best, worst } = useMemo(() => bestAndWorstDay(points), [points]);

  function handleClick(state: { activeLabel?: string | number }) {
    const date = typeof state?.activeLabel === "string" ? state.activeLabel : null;
    if (date && entryDates.has(date)) onOpenEntry(date);
  }

  return (
    <ModuleCard
      title="Mood & energy"
      aside={
        <div className="flex items-center gap-4">
          {/* direct series labels — identity never rides on color alone */}
          <span className="flex items-center gap-3 text-[12px] text-ink-soft">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES.mood }} /> mood
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES.energy }} /> energy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: SERIES.mood }} /> best day
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: CHROME.muted }} /> hardest day
            </span>
          </span>
          <div className="flex gap-0.5">
            {RANGES.map((r) => (
              <button key={r.label} onClick={() => setRange(r)} aria-pressed={r.label === range.label} className="seg">
                {r.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} onClick={handleClick} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: CHROME.muted, fontSize: 10.5 }}
              tickFormatter={(d: string) => d.slice(5)}
              stroke={CHROME.axis}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={48}
            />
            <YAxis
              domain={[1, 10]}
              ticks={[2, 4, 6, 8, 10]}
              tick={{ fill: CHROME.muted, fontSize: 10.5 }}
              stroke="transparent"
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHROME.axis, strokeDasharray: "2 3" }} />
            {/* raw daily points: faint dots, gaps stay gaps (never zeros) */}
            <Line dataKey="mood" stroke="none" dot={{ r: 2, fill: SERIES.mood, fillOpacity: 0.35, strokeWidth: 0 }} isAnimationActive={false} />
            <Line dataKey="energy" stroke="none" dot={{ r: 2, fill: SERIES.energy, fillOpacity: 0.35, strokeWidth: 0 }} isAnimationActive={false} />
            {/* 7-day rolling averages: the bold signal lines, drawn in on load.
                Nulls are not bridged — after a week with no entries the line
                breaks rather than drawing a trend through days nobody recorded. */}
            <Line
              dataKey="moodAvg"
              stroke={SERIES.mood}
              strokeWidth={2}
              dot={false}
              isAnimationActive={!REDUCED_MOTION}
              animationDuration={700}
              animationEasing="ease-out"
            />
            <Line
              dataKey="energyAvg"
              stroke={SERIES.energy}
              strokeWidth={2}
              dot={false}
              isAnimationActive={!REDUCED_MOTION}
              animationDuration={700}
              animationEasing="ease-out"
            />
            {best && (
              <ReferenceDot x={best.date} y={best.mood!} r={4} fill={CHROME.surface} stroke={SERIES.mood} strokeWidth={1.5} />
            )}
            {worst && (
              <ReferenceDot x={worst.date} y={worst.mood!} r={4} fill={CHROME.surface} stroke={CHROME.muted} strokeWidth={1.5} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ModuleCard>
  );
}
