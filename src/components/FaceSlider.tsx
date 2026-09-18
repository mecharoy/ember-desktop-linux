// A 1–10 slider on a coloured track with a drawn face that follows the score:
// for mood the mouth and brows move from a frown to a grin, for energy the
// eyes go from shut and sleepy to wide open with sparks around the head.

type Kind = "mood" | "energy";

const RAMPS: Record<Kind, string[]> = {
  mood: ["#a8382c", "#d0652f", "#dca13a", "#9fae45", "#4f9a4f"],
  energy: ["#6e7d99", "#4f8db0", "#4ea68f", "#dfa62c", "#e0662a"],
};

const WORDS: Record<Kind, string[]> = {
  mood: ["awful", "rough", "low", "meh", "okay", "fine", "good", "really good", "great", "wonderful"],
  energy: ["empty", "drained", "tired", "sluggish", "steady", "fine", "lively", "energetic", "charged", "buzzing"],
};

function hex(c: string): number[] {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

/** The ramp's colour at t in [0, 1]. */
function colorAt(kind: Kind, t: number): string {
  const ramp = RAMPS[kind];
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  const a = hex(ramp[i]);
  const b = hex(ramp[i + 1]);
  const k = x - i;
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
}

function Face({ kind, t, color, faded }: { kind: Kind; t: number; color: string; faded: boolean }) {
  const ink = "#28231e";
  const mouthY = kind === "mood" ? 42 : 43;
  // Mood: -1 frown … +1 grin. Energy keeps a mild mouth that opens up high.
  const curve = kind === "mood" ? (t - 0.45) * 2 : (t - 0.3) * 1.2;
  const mouth = `M22 ${mouthY - curve * 2} Q32 ${mouthY + curve * 9} 42 ${mouthY - curve * 2}`;
  // Low mood lifts the inner ends of the brows (sad, not angry). Above
  // neutral the tilt is clamped flat rather than flipping the other way,
  // which pointed the inner ends down and read as a furrowed, evil grin.
  const browTilt = kind === "mood" ? Math.min(0, (t - 0.5) * 6) : 0;
  const eyeOpen = kind === "energy" ? 0.4 + t * 4 : 3.2;
  return (
    <svg viewBox="0 0 64 64" className={`h-14 w-14 shrink-0 transition-opacity duration-200 ${faded ? "opacity-40" : ""}`} aria-hidden="true">
      {kind === "energy" && t > 0.7 && (
        <g stroke={color} strokeWidth="2.4" strokeLinecap="round" opacity={(t - 0.7) / 0.3}>
          <path d="M32 2 V7" />
          <path d="M9 11 L13 15" />
          <path d="M55 11 L51 15" />
          <path d="M2 32 H7" />
          <path d="M62 32 H57" />
        </g>
      )}
      <circle cx="32" cy="34" r="22" fill={color} fillOpacity="0.28" stroke={color} strokeWidth="2.5" />
      {/* brows */}
      <path d={`M19 ${24 - browTilt} L27 ${24 + browTilt}`} stroke={ink} strokeWidth="2" strokeLinecap="round" />
      <path d={`M37 ${24 + browTilt} L45 ${24 - browTilt}`} stroke={ink} strokeWidth="2" strokeLinecap="round" />
      {/* eyes */}
      {kind === "energy" && t < 0.2 ? (
        <>
          <path d="M20 31 Q23.5 33 27 31" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M37 31 Q40.5 33 44 31" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <text x="48" y="16" fontSize="10" fill={ink} fontFamily="serif" fontStyle="italic">
            z
          </text>
          <text x="54" y="9" fontSize="7" fill={ink} fontFamily="serif" fontStyle="italic">
            z
          </text>
        </>
      ) : (
        <>
          <ellipse cx="23.5" cy="31" rx="2.8" ry={eyeOpen} fill={ink} />
          <ellipse cx="40.5" cy="31" rx="2.8" ry={eyeOpen} fill={ink} />
        </>
      )}
      <path d={mouth} stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function FaceSlider({
  kind,
  label,
  value,
  onChange,
}: {
  kind: Kind;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const shown = value ?? 5;
  const t = (shown - 1) / 9;
  const color = colorAt(kind, t);
  const track = `linear-gradient(to right, ${RAMPS[kind].join(", ")})`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        {value !== null ? (
          <button type="button" onClick={() => onChange(null)} className="text-[12px] text-ink-faint hover:text-ink">
            clear
          </button>
        ) : (
          <span className="text-[12px] italic text-ink-faint">slide to set</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <Face kind={kind} t={t} color={color} faded={value === null} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={shown}
            aria-label={label}
            aria-valuetext={value === null ? "not set" : `${value} of 10, ${WORDS[kind][value - 1]}`}
            onChange={(e) => onChange(Number(e.target.value))}
            // A tap on the thumb where it already sits changes nothing, so
            // it would never count as an answer without this.
            onPointerUp={(e) => value === null && onChange(Number((e.target as HTMLInputElement).value))}
            className={`face-slider w-full ${value === null ? "unset" : ""}`}
            style={{ background: track, ["--thumb" as string]: color }}
          />
          <span className="font-serif text-[15px] text-ink" style={{ opacity: value === null ? 0.45 : 1 }}>
            {value === null ? "—" : `${value}/10 · ${WORDS[kind][value - 1]}`}
          </span>
        </div>
      </div>
    </div>
  );
}
