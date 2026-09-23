import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  captureHourHistogram,
  moodByWeekday,
  overallMood,
  WEEKDAY_MIN_DAYS,
  type DayRow,
} from "../../insights/stats";
import { ModuleCard } from "./ModuleCard";
import { CHROME, WING_RAMP, REDUCED_MOTION, SERIES } from "./palette";

interface BarTooltipProps {
  active?: boolean;
  payload?: { payload: Record<string, unknown> }[];
  formatter: (p: Record<string, unknown>) => string;
}

function BarTooltip({ active, payload, formatter }: BarTooltipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] text-fg shadow-[0_4px_14px_rgba(40,35,30,0.12)]">
      {formatter(p)}
    </div>
  );
}

/** Confidence as opacity, from the actual number of days — not
 * relative to the busiest weekday, which made seven one-day bars all look
 * fully reliable. Under WEEKDAY_MIN_DAYS the bar is a faint placeholder. */
function barOpacity(n: number): number {
  if (n < WEEKDAY_MIN_DAYS) return 0.15;
  return 0.35 + 0.65 * (Math.min(n, 8) / 8);
}

function weekdayLabel(p: Record<string, unknown>): string {
  const n = p.n as number;
  if (n === 0) return `${p.weekday}: no days yet`;
  if (n < WEEKDAY_MIN_DAYS) return `${p.weekday}: only ${n} day${n === 1 ? "" : "s"}, too few to say`;
  return `${p.weekday}: average mood ${(p.avg as number).toFixed(1)} (${n} days)`;
}

export default function WeekRhythm({ rows, captureTimes }: { rows: DayRow[]; captureTimes: string[] }) {
  const weekdays = moodByWeekday(rows);
  const usual = overallMood(rows);
  const hours = captureHourHistogram(captureTimes);
  const maxHour = Math.max(...hours.map((h) => h.count), 1);
  const animation = { isAnimationActive: !REDUCED_MOTION, animationDuration: 600, animationEasing: "ease-out" as const };

  return (
    <ModuleCard title="Week rhythm">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <p className="hint mb-2">Mood by weekday, last 3 months.</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdays.map((w) => ({ ...w, avg: w.avg ?? 0 }))} margin={{ top: 4, right: 52, bottom: 0, left: -28 }}>
                <XAxis dataKey="weekday" tick={{ fill: CHROME.muted, fontSize: 10.5 }} stroke={CHROME.axis} tickLine={false} />
                <YAxis domain={[0, 10]} ticks={[5, 10]} tick={{ fill: CHROME.muted, fontSize: 10.5 }} stroke="transparent" />
                <Tooltip cursor={{ fill: CHROME.hover }} content={<BarTooltip formatter={weekdayLabel} />} />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]} {...animation}>
                  {weekdays.map((w) => (
                    <Cell key={w.weekday} fill={SERIES.mood} fillOpacity={barOpacity(w.n)} />
                  ))}
                </Bar>
                {usual !== null && (
                  <ReferenceLine
                    y={usual}
                    stroke={CHROME.muted}
                    strokeDasharray="3 3"
                    label={{ value: `usual ${usual.toFixed(1)}`, position: "right", fill: CHROME.muted, fontSize: 10.5 }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <p className="hint mb-2">When you jot notes (last 90 days).</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hours} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <XAxis
                  dataKey="hour"
                  ticks={[0, 6, 12, 18, 23]}
                  tickFormatter={(h: number) => `${h}h`}
                  tick={{ fill: CHROME.muted, fontSize: 10.5 }}
                  stroke={CHROME.axis}
                  tickLine={false}
                />
                <YAxis hide domain={[0, maxHour]} />
                <Tooltip
                  cursor={{ fill: CHROME.hover }}
                  content={
                    <BarTooltip
                      formatter={(p) => `${p.hour}:00 to ${p.hour}:59 · ${p.count} note${p.count === 1 ? "" : "s"}`}
                    />
                  }
                />
                <Bar dataKey="count" fill={WING_RAMP[2]} radius={[4, 4, 0, 0]} {...animation} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </ModuleCard>
  );
}
