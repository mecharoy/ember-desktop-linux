import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayRow } from "../../insights/stats";
import { topicMonth, type TopicDay, type TopicGroup } from "../../insights/topicMonth";
import { shortDate } from "../../insights/format";
import { useBackButton } from "../../useBackButton";
import { CHROME, REDUCED_MOTION, sentimentColor } from "./palette";

function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function feeling(s: number | null): string {
  if (s === null) return "";
  if (s >= 0.25) return "felt good";
  if (s <= -0.25) return "felt heavy";
  return "felt mixed";
}

interface TooltipPayload {
  active?: boolean;
  payload?: { payload: TopicDay }[];
}

function ChartTooltip({ active, payload }: TooltipPayload) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="max-w-60 rounded-md border border-rule bg-sheet px-3 py-2 text-[12px] shadow-[0_4px_14px_rgba(40,35,30,0.12)]">
      <div className="text-ink">{shortDate(p.date)}</div>
      <div className="mt-0.5 text-ink-soft">
        {!p.journaled ? "No entry" : p.mentioned ? `Came up${p.sentiment !== null ? ` · ${feeling(p.sentiment)}` : ""}` : "Didn't come up"}
        {p.mood !== null && <span className="text-ink-faint"> · mood {p.mood}</span>}
      </div>
      {p.summary && <div className="mt-1 font-serif text-[14px] leading-snug text-ink">{p.summary}</div>}
      {p.journaled && <div className="mt-1 text-[11px] text-ink-faint">Tap to open the entry</div>}
    </div>
  );
}

/** A mood point; larger and tinted by how the entry felt when the name came up. */
function MoodDot(props: { cx?: number; cy?: number; payload?: TopicDay }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload || payload.mood === null) return null;
  if (!payload.mentioned) return <circle cx={cx} cy={cy} r={2.5} fill={CHROME.ink} />;
  return <circle cx={cx} cy={cy} r={5.5} fill={sentimentColor(payload.sentiment ?? 0)} stroke={CHROME.surface} strokeWidth={1.5} />;
}

/**
 * One theme or person, a day at a time for a month: the mood line, with a
 * band and a larger dot on the days it came up (tinted by how the entry felt
 * about it). Opens in the middle of the screen from the small chart in the
 * Themes and People lists.
 */
export default function TopicMonthDialog({
  group,
  name,
  rows,
  todayKey,
  entryDates,
  onOpenEntry,
  onOpenEntries,
  onClose,
}: {
  group: TopicGroup;
  name: string;
  rows: DayRow[];
  todayKey: string;
  entryDates: Set<string>;
  onOpenEntry: (date: string) => void;
  onOpenEntries: () => void;
  onClose: () => void;
}) {
  const currentMonth = todayKey.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const firstMonth = rows[0]?.date.slice(0, 7) ?? currentMonth;

  useBackButton(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const days = useMemo(() => topicMonth(rows, group, name, month, todayKey), [rows, group, name, month, todayKey]);
  const cameUp = days.filter((d) => d.mentioned).length;
  const journaled = days.filter((d) => d.journaled).length;
  const cameUpDays = days.filter((d) => d.mentioned);

  function handleClick(state: { activeLabel?: string | number }) {
    const date = typeof state?.activeLabel === "string" ? state.activeLabel : null;
    if (date && entryDates.has(date)) onOpenEntry(date);
  }

  // Into the page itself: inside a scrolled section, "fixed" would be measured
  // from that section and the dialog would open off screen.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="fade-in absolute inset-0 bg-ink/30" />
      <div
        role="dialog"
        aria-label={`${name}, day by day`}
        className="fade-up relative flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl border border-rule bg-sheet p-5 shadow-[0_12px_32px_-12px_rgba(40,35,30,0.35)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11.5px] uppercase tracking-wide text-ink-faint">{group === "themes" ? "Theme" : "Person"}</p>
            <h2 className="font-serif text-[22px] leading-tight text-ink">{name}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2 -mt-1" aria-label="Close">
            &times;
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[12.5px] text-ink-soft">
            <button
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={month <= firstMonth}
              className="btn-ghost px-2"
              aria-label="Previous month"
            >
              &lsaquo;
            </button>
            <span className="w-32 text-center font-serif text-[16px] text-ink">{monthLabel(month)}</span>
            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={month >= currentMonth}
              className="btn-ghost px-2"
              aria-label="Next month"
            >
              &rsaquo;
            </button>
          </div>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
            <span className="text-ink-faint">Came up, felt:</span>
            {(
              [
                ["good", 0.7],
                ["mixed", 0],
                ["heavy", -0.7],
              ] as const
            ).map(([label, value]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: sentimentColor(value) }} /> {label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: CHROME.ink }} /> mood
            </span>
          </span>
        </div>

        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={days} onClick={handleClick} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: CHROME.muted, fontSize: 10.5 }}
                tickFormatter={(d: string) => String(Number(d.slice(8, 10)))}
                stroke={CHROME.axis}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={14}
              />
              <YAxis yAxisId="mood" domain={[1, 10]} ticks={[2, 4, 6, 8, 10]} tick={{ fill: CHROME.muted, fontSize: 10.5 }} stroke="transparent" />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHROME.axis, strokeDasharray: "2 3" }} />
              {cameUpDays.map((d) => (
                <ReferenceLine
                  key={d.date}
                  yAxisId="mood"
                  x={d.date}
                  stroke={sentimentColor(d.sentiment ?? 0)}
                  strokeWidth={14}
                  strokeOpacity={0.16}
                />
              ))}
              <Line
                yAxisId="mood"
                dataKey="mood"
                stroke={CHROME.ink}
                strokeWidth={2}
                dot={<MoodDot />}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={!REDUCED_MOTION}
                animationDuration={600}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-soft">
            {journaled === 0
              ? "No entries this month."
              : `Came up on ${cameUp} of ${journaled} journaled ${journaled === 1 ? "day" : "days"}.`}
          </p>
          <button onClick={onOpenEntries} className="btn-subtle">
            Open the entries
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
