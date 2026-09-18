// Chart palette for the Insights page on the paper surface (#f6f1e7),
// validated with the dataviz palette validator (light mode, that surface):
// - categorical pair mood/energy: CVD ΔE 19.4 (protan), normal-vision 25.7,
//   both ≥3:1 against the paper
// - ember ordinal ramp (heat/intensity): monotone L, light end 2.19:1
// Series identity is never color-alone: both chart series carry direct labels.

export const SERIES = {
  mood: "#b3441a", // the app's ember accent
  energy: "#2f64a0",
} as const;

/** One-hue ember ramp for intensity (heat grid, histogram), low→high. */
export const EMBER_RAMP = ["#d9957a", "#c46a42", "#b3441a", "#86310f"] as const;

/** Done-days of a habit the user wants LESS of: a quiet cool tone, so doing
 * it more never reads as the warm "well done" ember. */
export const HABIT_LESS = "#3f6796";

export const CHROME = {
  surface: "#f6f1e7",
  grid: "#e6ddcd",
  axis: "#c7baa3",
  muted: "#766c60",
  ink: "#28231e",
  deltaUp: "#3d6b35", // calm green; down-deltas stay muted, no alarm colors
  emptyCell: "#e5dccb",
  hover: "rgba(40, 35, 30, 0.05)",
} as const;

/** Charts draw their lines and bars in, unless the system asks for less motion. */
export const REDUCED_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const WARM = [0xb3, 0x44, 0x1a]; // +1 sentiment
const NEUTRAL = [0x8a, 0x80, 0x73]; // 0
const COOL = [0x2f, 0x64, 0xa0]; // -1

/** Warm↔cool diverging sentiment tint with a neutral gray midpoint. */
export function sentimentColor(s: number | null): string {
  if (s === null) return CHROME.muted;
  const t = Math.max(-1, Math.min(1, s));
  const [from, to] = t >= 0 ? [NEUTRAL, WARM] : [NEUTRAL, COOL];
  const k = Math.abs(t);
  const mix = from.map((f, i) => Math.round(f + (to[i] - f) * k));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
