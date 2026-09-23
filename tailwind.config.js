/** @type {import('tailwindcss').Config} */
// Elytra's palette — the specimen cabinet, in two lights.
//
// The app is a case; the days are cards inside it. Dark is the default and the
// one the design was drawn for: the cabinet is dark, and the pale entry glows
// against it. Light is the same cabinet in daylight — the ground goes to cream,
// the ink goes dark, and the entry still sits on its own paper.
//
// Token names describe the ROLE, not the colour, which is what makes one set of
// class names work in both:
//   ground  the cabinet floor — the window's base
//   surface a raised panel on it; surface-high is its hover. NOTE: raised means
//           DARKER than the ground in the dark theme and LIGHTER in the light
//           one. Never hard-code a direction; use the token.
//   line    hairlines, the only division the design uses
//   fg      text, in three weights
//   moss    the accent, and the only one that had to be re-chosen rather than
//           flipped: #7fb27c reads 7.1:1 on the dark ground but only 2.8:1 on
//           cream, so the light theme uses #33512f (7.9:1) instead.
//   speak   the filled card Elytra's questions sit in, and the text on it.
//           This pair does NOT flip: a deep green card with pale text is the
//           same object in both themes, which is why it cannot be built out of
//           `moss-deep` + `fg` any more.
//   clay    the rare warm note: a streak, a milestone
//   paper   the entry page, which keeps its own colours (components/paper.ts)
//
// Every value is a space-separated RGB triple in a CSS variable so Tailwind's
// opacity modifiers (bg-ground/95, text-fg/80) still work, and so the whole
// palette can be swapped by setting data-theme on <html> (src/theme.ts).
//
// The measured contrast for both sets is in src/index.css beside the values.
// Recompute with a contrast script if any of them move — do not eyeball it.
const c = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ground: { DEFAULT: c("--c-ground"), deep: c("--c-ground-deep") },
        surface: { DEFAULT: c("--c-surface"), high: c("--c-surface-high") },
        line: { DEFAULT: c("--c-line"), strong: c("--c-line-strong") },
        fg: { DEFAULT: c("--c-fg"), dim: c("--c-fg-dim"), faint: c("--c-fg-faint") },
        moss: {
          DEFAULT: c("--c-moss"),
          bright: c("--c-moss-bright"),
          deep: c("--c-moss-deep"),
          wash: c("--c-moss-wash"),
        },
        speak: { DEFAULT: c("--c-speak"), fg: c("--c-speak-fg") },
        clay: { DEFAULT: c("--c-clay"), wash: c("--c-clay-wash") },
        danger: { DEFAULT: c("--c-danger"), wash: c("--c-danger-wash") },
        paper: { DEFAULT: c("--c-paper"), dim: c("--c-paper-dim") },
      },
      fontFamily: {
        serif: ['"Instrument Serif"', '"Iowan Old Style"', "Georgia", "serif"],
        sans: ['"Epilogue Variable"', "system-ui", '"Segoe UI Variable Text"', '"Segoe UI"', "-apple-system", "sans-serif"],
        mono: ['"IBM Plex Mono"', '"Cascadia Mono"', "Consolas", "monospace"],
        hand: ['"Caveat Variable"', '"Segoe Print"', '"Bradley Hand"', "cursive"],
      },
      transitionTimingFunction: {
        settle: "cubic-bezier(0.22, 0.8, 0.24, 1)",
        alight: "cubic-bezier(0.16, 0.9, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
