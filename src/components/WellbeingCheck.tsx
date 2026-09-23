import { useState } from "react";
import type { Instrument } from "../db/types";
import { saveAssessment } from "../db/assessments";
import {
  bandFor,
  displayScore,
  INSTRUMENTS,
  isComplete,
  needsCare,
  PHQ9_DIFFICULTY,
  rawScore,
  scaleLabel,
} from "../insights/assessments";

/** What the score means, in one plain line. Never a diagnosis. */
function meaning(instrument: Instrument, raw: number): string {
  const band = bandFor(instrument, raw);
  if (instrument === "who5") {
    return band.worthALook
      ? "Below 50. The WHO suggests that's worth a closer look, for example a talk with a doctor."
      : "50 or above: in the range the WHO counts as reasonable well-being.";
  }
  const what = instrument === "phq9" ? "low mood" : "anxiety";
  return band.worthALook
    ? `In the ${band.label} range. From 10 up, doctors usually take a closer look at ${what}; it's worth mentioning to one.`
    : `In the ${band.label} range for ${what}.`;
}

/**
 * One standard questionnaire, asked word for word. Saved
 * locally; only the total ever reaches an AI prompt. If PHQ-9 question 9 is
 * answered above zero, help is shown first — before the score.
 */
export default function WellbeingCheck({
  instrument,
  date,
  onDone,
  onCancel,
}: {
  instrument: Instrument;
  date: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const def = INSTRUMENTS[instrument];
  const [answers, setAnswers] = useState<(number | null)[]>(() => def.items.map(() => null));
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ raw: number; care: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const complete = isComplete(instrument, answers);
  const anyAboveZero = answers.some((a) => (a ?? 0) > 0);

  function setAnswer(i: number, value: number) {
    setAnswers((prev) => prev.map((a, k) => (k === i ? value : a)));
  }

  async function handleSave() {
    if (!isComplete(instrument, answers)) return;
    setSaving(true);
    const raw = rawScore(answers);
    await saveAssessment({
      instrument,
      date,
      answers,
      score: raw,
      difficulty: instrument === "phq9" && anyAboveZero ? difficulty : null,
    });
    setSaving(false);
    setSaved({ raw, care: needsCare(instrument, answers) });
  }

  if (saved) {
    return (
      <div className="fade-up flex max-w-xl flex-col gap-4">
        {saved.care && (
          <div className="rounded-md border border-danger/40 bg-danger-wash px-4 py-3 text-[14px] leading-relaxed text-fg">
            <p className="font-serif text-[16px]">Thank you for answering that honestly.</p>
            <p className="mt-1.5">
              You said you&rsquo;ve had thoughts of being better off dead or of hurting yourself. That matters more than
              any score. Please tell someone you trust, and talk to a doctor soon. If you might act on those thoughts,
              call your local emergency number now. To find a crisis line where you live, go to findahelpline.com.
            </p>
          </div>
        )}
        <div>
          <p className="label">{def.name}</p>
          <p className="mt-1 font-serif text-[30px] leading-none text-fg">
            {displayScore(instrument, saved.raw)}
            <span className="ml-1 font-sans text-[13px] text-fg-faint">{scaleLabel(instrument)}</span>
          </p>
          <p className="hint mt-2">{meaning(instrument, saved.raw)}</p>
          <p className="hint mt-1">A questionnaire like this screens; it doesn&rsquo;t diagnose.</p>
        </div>
        <div>
          <button onClick={onDone} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up flex max-w-2xl flex-col gap-5">
      <div>
        <h3 className="section-title">{def.name}</h3>
        <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-fg-dim">{def.stem}</p>
      </div>

      <ol className="flex flex-col gap-4">
        {def.items.map((item, i) => (
          <li key={item} className="flex flex-col gap-2">
            <span className="font-serif text-[15.5px] leading-snug text-fg">
              {i + 1}. {item}
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={item}>
              {def.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setAnswer(i, o.value)}
                  aria-pressed={answers[i] === o.value}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-200 ${
                    answers[i] === o.value
                      ? "border-moss bg-moss text-ground"
                      : "border-line text-fg-dim hover:border-fg-faint hover:text-fg"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {instrument === "phq9" && anyAboveZero && (
        <div className="flex flex-col gap-2">
          <span className="font-serif text-[15.5px] leading-snug text-fg">{PHQ9_DIFFICULTY.question}</span>
          <div className="flex flex-wrap gap-1.5">
            {PHQ9_DIFFICULTY.options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setDifficulty(o.value)}
                aria-pressed={difficulty === o.value}
                className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-200 ${
                  difficulty === o.value
                    ? "border-moss bg-moss text-ground"
                    : "border-line text-fg-dim hover:border-fg-faint hover:text-fg"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={!complete || saving} className="btn-primary">
          {saving ? "Saving…" : "Save answers"}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="btn-ghost">
            Not now
          </button>
        )}
        {!complete && <span className="text-[12px] text-fg-faint">Answer every question to save.</span>}
      </div>

      <p className="text-[11px] leading-snug text-fg-faint">
        Your answers stay on this computer; only the total goes into Elytra&rsquo;s reviews. {def.attribution}
      </p>
    </div>
  );
}
