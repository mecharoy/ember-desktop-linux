import type { CSSProperties } from "react";

/**
 * The papers a journal entry can be written on. Each sets the page colour,
 * its ruling, the margin line and an ink that reads on it: every ink clears
 * 7:1 contrast on its paper, and the soft ink (labels) clears 4.5:1.
 */
export interface Paper {
  id: string;
  label: string;
  bg: string;
  line: string;
  margin: string;
  ink: string;
  soft: string;
  tape: string;
}

export const PAPERS: Paper[] = [
  { id: "cream", label: "Cream", bg: "#fbf6ea", line: "#cfdbe6", margin: "#e0a296", ink: "#1f2d45", soft: "#56627a", tape: "#e9b8a3" },
  { id: "sky", label: "Sky", bg: "#e5eff8", line: "#b5c8da", margin: "#d59f9f", ink: "#1b2a44", soft: "#4a5a74", tape: "#f1d58e" },
  { id: "blush", label: "Blush", bg: "#f8e5e3", line: "#e2c0c0", margin: "#c98791", ink: "#35202b", soft: "#6c4a57", tape: "#a9c9b8" },
  { id: "sage", label: "Sage", bg: "#e6efe1", line: "#bdd0b6", margin: "#d4a197", ink: "#1f3024", soft: "#4c6150", tape: "#e8b4b8" },
  { id: "lavender", label: "Lavender", bg: "#ede7f5", line: "#cfc3e0", margin: "#d0a0b2", ink: "#2a2140", soft: "#5a5070", tape: "#f0cf8c" },
  { id: "butter", label: "Butter", bg: "#fbf0c8", line: "#ddd09e", margin: "#dc9c86", ink: "#33291a", soft: "#65583e", tape: "#9fc3d9" },
  { id: "kraft", label: "Kraft", bg: "#dcc7a4", line: "#c1a67f", margin: "#9f6448", ink: "#261b10", soft: "#4d3c29", tape: "#f3ead6" },
  { id: "night", label: "Night", bg: "#28303c", line: "#3c4858", margin: "#8c5d5d", ink: "#ece6d6", soft: "#b9b3a4", tape: "#b3441a" },
];

export const DEFAULT_PAPER = "cream";

export function paperById(id: string | null | undefined): Paper {
  return PAPERS.find((p) => p.id === id) ?? PAPERS.find((p) => p.id === DEFAULT_PAPER)!;
}

/** The custom properties .paper-sheet and .hand read (index.css). */
export function paperStyle(id: string | null | undefined): CSSProperties {
  const p = paperById(id);
  const dark = p.id === "night";
  return {
    "--paper-bg": p.bg,
    "--paper-line": p.line,
    "--paper-margin": p.margin,
    "--paper-ink": p.ink,
    "--paper-soft": p.soft,
    "--paper-tape": p.tape,
    "--paper-hole": "#e8e0d0",
    "--paper-focus": dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.45)",
  } as CSSProperties;
}
