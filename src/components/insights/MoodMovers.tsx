import { moodMovers, type DayRow, type MoodFinding } from "../../insights/stats";
import { ModuleCard } from "./ModuleCard";

/** Plain sentences with counts — no coefficients, no p-values, ever. */
export default function MoodMovers({
  rows,
  dismissedHabits,
  onOpen,
}: {
  rows: DayRow[];
  dismissedHabits: Set<string>;
  onOpen: (finding: MoodFinding) => void;
}) {
  const findings = moodMovers(rows, dismissedHabits);

  return (
    <ModuleCard title="What moves your mood">
      {findings.length === 0 ? (
        <p className="hint max-w-xl">Nothing clear yet.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {findings.map((f) => (
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
