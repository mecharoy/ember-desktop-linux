import { APPROACHES, TONES, type ConversationApproach, type ConversationTone } from "../ai/prompts/style";

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; blurb: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
      <span className="label">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-xl border px-4 py-2.5 text-left transition-colors duration-200 ${
            value === o.id ? "border-ember/50 bg-ember-wash/50" : "border-rule bg-sheet/50"
          }`}
        >
          <span className="text-[15px] text-ink">{o.label}</span>
          <span className="mt-0.5 block text-[13px] text-ink-faint">{o.blurb}</span>
        </button>
      ))}
    </div>
  );
}

/** How the evening conversation sounds: tone and approach (ai/prompts/style.ts). */
export default function StylePicker({
  tone,
  approach,
  onTone,
  onApproach,
}: {
  tone: ConversationTone;
  approach: ConversationApproach;
  onTone: (v: ConversationTone) => void;
  onApproach: (v: ConversationApproach) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Choice label="Tone" options={TONES} value={tone} onChange={onTone} />
      <Choice label="Approach" options={APPROACHES} value={approach} onChange={onApproach} />
      <p className="hint">Ember is not a therapist. In a crisis, it points you to real help.</p>
    </div>
  );
}
