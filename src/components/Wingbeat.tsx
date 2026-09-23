import type { CSSProperties } from "react";

/**
 * The small inline mark for "something is on its way": two wing cases either
 * side of the seam, beating while `live`, folded shut when not.
 *
 * It sits next to text — in a message bubble, a banner, a settings row — and
 * is the quiet cousin of the full beetle. `tone` picks which token the wings
 * take: the accent on an ordinary surface, or the speaking card's own pale
 * ink when it sits inside that green card. Both follow the theme.
 */
export default function Wingbeat({
  live = true,
  tone = "moss",
  className = "",
}: {
  live?: boolean;
  tone?: "moss" | "cream";
  className?: string;
}) {
  return (
    <span
      className={`wingbeat ${live ? "live" : ""} ${className}`}
      style={tone === "cream" ? ({ "--wing": "rgb(var(--c-speak-fg) / 0.85)" } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      <i />
      <i />
    </span>
  );
}
