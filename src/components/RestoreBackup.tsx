import { useState } from "react";
import { pickBackup, restorePickedBackup } from "../backup";
import type { BackupSummary } from "../db/backup";

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Pick a backup, see what's in it, then restore it. `label` and `buttonClass`
 *  style the first button; `warning` is shown above Restore when there is a
 *  journal to lose. */
export default function RestoreBackup({
  label,
  buttonClass,
  warning,
}: {
  label: string;
  buttonClass: string;
  warning?: string;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "picking" }
    | { status: "picked"; summary: BackupSummary }
    | { status: "restoring" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  async function pick() {
    setState({ status: "picking" });
    try {
      const summary = await pickBackup();
      setState(summary ? { status: "picked", summary } : { status: "idle" });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function restore() {
    setState({ status: "restoring" });
    try {
      await restorePickedBackup();
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (state.status === "picked" || state.status === "restoring") {
    const s = state.status === "picked" ? state.summary : null;
    return (
      <div className="fade-up flex flex-col gap-2 rounded-xl border border-line bg-surface/60 px-4 py-3 text-left">
        {s && (
          <>
            <p className="font-serif text-[17px] text-fg">{s.name ? `${s.name}’s journal` : "Elytra journal"}</p>
            <p className="text-[13.5px] leading-relaxed text-fg-dim">
              {s.entries + s.notes === 0
                ? "Nothing written in it yet."
                : `${plural(s.entries, "entry", "entries")} and ${plural(s.notes, "note", "notes")}${
                    s.lastDay ? `, the latest from ${dayLabel(s.lastDay)}` : ""
                  }.`}
            </p>
            {warning && <p className="text-[13.5px] leading-relaxed text-fg">{warning}</p>}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={restore} disabled={state.status === "restoring"} className="btn-primary">
            {state.status === "restoring" ? "Restoring…" : "Restore"}
          </button>
          <button onClick={pick} disabled={state.status === "restoring"} className="btn-ghost">
            Pick another file
          </button>
          <button onClick={() => setState({ status: "idle" })} disabled={state.status === "restoring"} className="btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button onClick={pick} disabled={state.status === "picking"} className={buttonClass}>
        {state.status === "picking" ? "Opening…" : label}
      </button>
      {state.status === "error" && <p className="mt-1 text-[13.5px] text-danger">{state.message}</p>}
    </>
  );
}
