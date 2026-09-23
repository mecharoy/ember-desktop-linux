import { currentTheme, onThemeChange, type Theme } from "../../theme";

// Chart colours for Patterns — one set per theme, each CHOSEN against its own
// surface and validated, never one set flipped.
//
// That is not a style preference, it is the trap this file exists to avoid:
// the light pair (#43903c / #1f6f9c) was re-measured on the dark surface and
// the blue came back at 2.87:1, under the 3:1 floor. Inverting a palette
// silently breaks it.
//
// Validated (scripted, not eyeballed):
//   dark, surface #1e241e — mood 5.07:1, energy 4.54:1, habit-less 4.62:1,
//     mood↔energy ΔE 67.8, ramp monotone, dim end 2.77:1 (a fill, not text).
//     The ramp runs dim→bright as the value rises, so "more" reads brighter.
//   light, surface #ffffff — mood 3.97:1, energy 5.51:1, habit-less 5.51:1,
//     mood↔energy ΔE 76.4, ramp monotone the OTHER WAY, pale→deep, because on
//     white "more" has to read darker.
// Series identity is never colour alone: both series carry direct labels.

interface ChartPalette {
  series: { mood: string; energy: string };
  ramp: readonly [string, string, string, string];
  habitLess: string;
  chrome: {
    surface: string;
    grid: string;
    axis: string;
    muted: string;
    ink: string;
    deltaUp: string;
    emptyCell: string;
    hover: string;
  };
  sentiment: { warm: number[]; neutral: number[]; cool: number[] };
}

const PALETTES: Record<Theme, ChartPalette> = {
  dark: {
    series: { mood: "#63a05f", energy: "#4a8fc4" },
    ramp: ["#43713f", "#669763", "#8cb887", "#b4d3af"],
    habitLess: "#4e8fcc",
    chrome: {
      surface: "#1e241e",
      // Gridlines and axes are deliberately below 3:1 — they are not data, and
      // a grid that competes with the marks is the commonest chart mistake.
      grid: "#2e352d",
      axis: "#3a4238",
      muted: "#8e978a",
      ink: "#e4e7dc",
      deltaUp: "#7fb27c",
      emptyCell: "#252c24",
      hover: "rgba(228, 231, 220, 0.06)",
    },
    sentiment: { warm: [0xcc, 0x7f, 0x58], neutral: [0x8a, 0x8f, 0x85], cool: [0x4a, 0x8f, 0xc4] },
  },
  light: {
    series: { mood: "#43903c", energy: "#1f6f9c" },
    ramp: ["#c3dcbe", "#94c08e", "#65a05e", "#3a7534"],
    habitLess: "#1f6f9c",
    chrome: {
      surface: "#ffffff",
      grid: "#e6e4d7",
      axis: "#cdcbb9",
      muted: "#5f665c",
      ink: "#1d221d",
      deltaUp: "#33512f",
      emptyCell: "#eceadd",
      hover: "rgba(29, 34, 29, 0.05)",
    },
    sentiment: { warm: [0x8a, 0x4a, 0x23], neutral: [0x6f, 0x74, 0x6b], cool: [0x1f, 0x6f, 0x9c] },
  },
};

// The exports keep their old shapes so the nine chart files did not have to be
// rewritten: the objects are filled in place and `HABIT_LESS` is a live
// binding, both re-set whenever the theme changes. Charts themselves re-render
// because windows/Insights.tsx subscribes to the theme — a module that mutates
// cannot tell React anything on its own.
export const SERIES = { ...PALETTES.dark.series };
export const WING_RAMP: string[] = [...PALETTES.dark.ramp];
export const CHROME = { ...PALETTES.dark.chrome };
export let HABIT_LESS = PALETTES.dark.habitLess;

let sentiment = PALETTES.dark.sentiment;

function applyChartTheme(t: Theme) {
  const p = PALETTES[t];
  Object.assign(SERIES, p.series);
  Object.assign(CHROME, p.chrome);
  WING_RAMP.length = 0;
  WING_RAMP.push(...p.ramp);
  HABIT_LESS = p.habitLess;
  sentiment = p.sentiment;
}

applyChartTheme(currentTheme());
onThemeChange(applyChartTheme);

/** Charts draw their lines and bars in, unless the system asks for less motion. */
export const REDUCED_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Warm↔cool diverging sentiment tint with a neutral grey midpoint. */
export function sentimentColor(s: number | null): string {
  if (s === null) return CHROME.muted;
  const t = Math.max(-1, Math.min(1, s));
  const [from, to] = t >= 0 ? [sentiment.neutral, sentiment.warm] : [sentiment.neutral, sentiment.cool];
  const k = Math.abs(t);
  const mix = from.map((f, i) => Math.round(f + (to[i] - f) * k));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
