import type { KeyedSeries } from "../../insights/stats";
import Sparkline from "./Sparkline";
import { sentimentColor } from "./palette";

/** Shared row list for Themes and People: name · count ·
 * 8-week sparkline · sentiment tint · optional Rising/Fading badge. Click →
 * Journal filtered to the underlying entries. */
export default function KeyedRows({
  items,
  showTrend,
  onOpen,
  onExpand,
}: {
  items: KeyedSeries[];
  showTrend: boolean;
  onOpen: (item: KeyedSeries) => void;
  /** The small chart was tapped: show this one day by day. */
  onExpand: (item: KeyedSeries) => void;
}) {
  if (items.length === 0) {
    return <p className="hint">Nothing yet. Save a few more entries.</p>;
  }
  return (
    <>
    <ul className="-mx-2 flex flex-col">
      {items.map((t) => (
        <li key={t.key} className="flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-surface-high">
          <button
            onClick={() => onOpen(t)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left"
            title={`Open the ${t.count} entr${t.count === 1 ? "y" : "ies"} behind this`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: sentimentColor(t.sentiment) }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{t.key}</span>
            {showTrend && t.trend && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] ${
                  t.trend === "rising" ? "bg-moss-wash text-moss" : "bg-surface-high text-fg-faint"
                }`}
              >
                {t.trend === "rising" ? "rising" : "fading"}
              </span>
            )}
            <span className="w-8 text-right text-[12px] tabular-nums text-fg-faint">{t.count}×</span>
          </button>
          <button
            onClick={() => onExpand(t)}
            className="shrink-0 rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-line-strong active:bg-ground"
            title="See it day by day"
            aria-label={`${t.key}, day by day`}
          >
            <Sparkline values={t.spark} width={96} height={28} />
          </button>
        </li>
      ))}
    </ul>
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-faint">
      Dot, how it felt:
      {(
        [
          ["good", 0.7],
          ["mixed", 0],
          ["heavy", -0.7],
        ] as const
      ).map(([label, value]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: sentimentColor(value) }} aria-hidden="true" />
          {label}
        </span>
      ))}
    </p>
    </>
  );
}
