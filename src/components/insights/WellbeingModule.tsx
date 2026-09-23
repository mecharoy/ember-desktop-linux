import { useState } from "react";
import type { Assessment, Instrument } from "../../db/types";
import {
  bandFor,
  displayScore,
  dueInstruments,
  INSTRUMENT_ORDER,
  INSTRUMENTS,
  scaleLabel,
} from "../../insights/assessments";
import { ModuleCard } from "./ModuleCard";
import Sparkline from "./Sparkline";
import WellbeingCheck from "../WellbeingCheck";
import { shortDate } from "../../insights/format";

/** The questionnaires the user answered, with their published bands. */
export default function WellbeingModule({
  assessments,
  enabled,
  todayKey,
  onChanged,
}: {
  assessments: Assessment[];
  enabled: Instrument[];
  todayKey: string;
  onChanged: () => void;
}) {
  const [taking, setTaking] = useState<Instrument | null>(null);
  const shown = INSTRUMENT_ORDER.filter((i) => enabled.includes(i) || assessments.some((a) => a.instrument === i));
  const due = new Set(dueInstruments(enabled, assessments, todayKey, ""));

  if (taking) {
    return (
      <ModuleCard title="Wellbeing checks">
        <WellbeingCheck
          instrument={taking}
          date={todayKey}
          onDone={() => {
            setTaking(null);
            onChanged();
          }}
          onCancel={() => setTaking(null)}
        />
      </ModuleCard>
    );
  }

  return (
    <ModuleCard title="Wellbeing checks">
      {shown.length === 0 ? (
        <p className="hint max-w-xl">Two-weekly wellbeing questionnaires. Switch them on in Settings.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {shown.map((instrument) => {
            const history = assessments.filter((a) => a.instrument === instrument);
            const last = history[history.length - 1];
            const band = last ? bandFor(instrument, last.score) : null;
            return (
              <div key={instrument} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                <div className="w-56">
                  <p className="text-[13.5px] text-fg">{INSTRUMENTS[instrument].name}</p>
                  <p className="text-[12px] text-fg-faint">
                    {last ? `last taken ${shortDate(last.date)}` : "not taken yet"}
                  </p>
                </div>
                {last && band && (
                  <p className="flex items-baseline gap-2">
                    <span className="font-serif text-[24px] leading-none text-fg">{displayScore(instrument, last.score)}</span>
                    <span className="text-[12px] text-fg-faint">{scaleLabel(instrument)}</span>
                    <span className={`text-[12.5px] ${band.worthALook ? "text-moss" : "text-fg-dim"}`}>{band.label}</span>
                  </p>
                )}
                {history.length >= 2 && (
                  <Sparkline values={history.map((a) => displayScore(instrument, a.score))} width={96} height={24} />
                )}
                <div className="ml-auto">
                  {enabled.includes(instrument) && (
                    <button onClick={() => setTaking(instrument)} className={due.has(instrument) ? "btn-subtle" : "btn-ghost"}>
                      {due.has(instrument) ? "Due — take it" : "Take it again"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ModuleCard>
  );
}
