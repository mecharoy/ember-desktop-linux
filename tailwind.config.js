/** @type {import('tailwindcss').Config} */
// The paper journal palette. Text contrast on paper (#f6f1e7): ink 13.8:1,
// ink-soft 7.3:1, ink-faint 4.6:1, ember 5.0:1, so every text color clears
// WCAG AA for body text. Chart colors live in components/insights/palette.ts.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: "#f6f1e7", deep: "#eee7da", shade: "#e5dccb" },
        sheet: "#fcf9f3",
        rule: { DEFAULT: "#ddd3c1", strong: "#c7baa3" },
        ink: { DEFAULT: "#28231e", soft: "#564e45", faint: "#766c60" },
        ember: { DEFAULT: "#b3441a", deep: "#943712", wash: "#f2e0d2" },
        moss: { DEFAULT: "#3d6b35", wash: "#e3eadb" },
        danger: { DEFAULT: "#9e2f25", wash: "#f5e1dc" },
      },
      fontFamily: {
        serif: ['"Newsreader Variable"', '"Iowan Old Style"', "Georgia", "serif"],
        // The journal page's handwriting (bundled, like Newsreader).
        hand: ['"Caveat Variable"', '"Segoe Print"', '"Bradley Hand"', "cursive"],
        sans: ["Roboto", "system-ui", '"Segoe UI Variable Text"', '"Segoe UI"', "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        settle: "cubic-bezier(0.22, 0.8, 0.24, 1)",
      },
    },
  },
  plugins: [],
};
