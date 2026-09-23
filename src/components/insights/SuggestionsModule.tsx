import { useState } from "react";
import type { Patterns, Suggestion } from "../../ai/patterns";
import { ModuleCard } from "./ModuleCard";

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  start: "Habit to start",
  "cut back": "Habit to cut back",
  task: "Small task",
  change: "Change to try",
};

/**
 * The last section of Insights: what Elytra noticed goes together, and
 * practical ideas built on it. Any suggestion can become a tracked habit.
 */
export default function SuggestionsModule({
  patterns,
  state,
  trackedHabits,
  onFind,
  onTrack,
}: {
  patterns: Patterns | null;
  state: { busy: boolean; message: string | null };
  /** Canonical keys of habits already pinned. */
  trackedHabits: Set<string>;
  onFind: () => void;
  onTrack: (s: Suggestion, name: string, description: string) => Promise<void>;
}) {
  // The name each suggestion was added under, since it can be edited first.
  const [added, setAdded] = useState<Map<string, string>>(new Map());
  // Only one habit is edited at a time.
  const [naming, setNaming] = useState<{ title: string; name: string; description: string } | null>(null);

  async function track(s: Suggestion, name: string, description: string) {
    if (!name.trim()) return;
    await onTrack(s, name.trim(), description);
    setAdded((prev) => new Map(prev).set(s.title, name.trim()));
    setNaming(null);
  }

  const written = patterns ? new Date(patterns.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

  return (
    <ModuleCard title="Suggestions">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onFind} disabled={state.busy} className="btn-subtle">
          {state.busy ? "Reading your days…" : patterns ? "Look again" : "Find suggestions"}
        </button>
        {state.message ? (
          <span className="text-[12.5px] text-fg-faint">{state.message}</span>
        ) : (
          written && (
            <span className="text-[12.5px] text-fg-faint">
              From {patterns!.days} days, {written}.
              {Date.now() - new Date(patterns!.createdAt).getTime() > 30 * 86_400_000 &&
                " Over a month old: look again for ones that fit now."}
            </span>
          )
        )}
      </div>

      {!patterns && !state.busy && (
        <p className="hint max-w-xl">Elytra reads your recent days for what goes together, and suggests habits and small changes to try.</p>
      )}

      {patterns && patterns.habitLinks.length > 0 && (
        <div className="mb-5 flex flex-col gap-1.5">
          <h3 className="spec">What goes together</h3>
          <ul className="flex flex-col gap-2">
            {patterns.habitLinks.map((l) => (
              <li key={`${l.habit}-${l.linked_to}`} className="text-[14px] leading-snug text-fg">
                <span className="font-medium">{l.habit}</span> goes with <span className="font-medium">{l.linked_to}</span>
                <span className="block text-[12.5px] text-fg-faint">{l.how}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {patterns && patterns.suggestions.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {patterns.suggestions.map((s) => {
            const defaultName = (s.habit || s.title).trim();
            // Only while it is still one of the tracked habits: unpin or remove
            // it and the button comes back.
            const already = trackedHabits.has((added.get(s.title) ?? defaultName).trim().toLowerCase());
            return (
              <li key={s.title} className="flex flex-col gap-2 rounded-lg border border-line bg-surface/60 p-4">
                <span className="text-[11.5px] uppercase tracking-wide text-fg-faint">{KIND_LABEL[s.kind]}</span>
                <span className="font-serif text-[16px] leading-snug text-fg">{s.title}</span>
                <span className="text-[13px] leading-snug text-fg-dim">{s.why}</span>
                {already ? (
                  <span className="text-[12.5px] text-moss">In your habits</span>
                ) : naming?.title === s.title ? (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11.5px] uppercase tracking-wide text-fg-faint">Habit name</span>
                    <input
                      autoFocus
                        className="input min-h-[34px] py-1 text-[14px]"
                      value={naming.name}
                      aria-label="Habit name"
                        onChange={(e) => setNaming({ ...naming, name: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && void track(s, naming.name, naming.description)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11.5px] uppercase tracking-wide text-fg-faint">Description</span>
                      <textarea
                        className="input min-h-[52px] py-1 text-[14px] leading-snug"
                        value={naming.description}
                        aria-label="Habit description"
                        rows={2}
                        onChange={(e) => setNaming({ ...naming, description: e.target.value })}
                    />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => void track(s, naming.name, naming.description)} className="btn-chip">
                      Add
                    </button>
                    <button onClick={() => setNaming(null)} className="btn-ghost min-h-[30px] py-1 text-[12.5px]">
                      Cancel
                    </button>
                  </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setNaming({ title: s.title, name: defaultName, description: s.title })}
                    className="btn-chip self-start"
                  >
                    + Add to habits
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ModuleCard>
  );
}
