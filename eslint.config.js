// Lint exists for one reason: to catch the mistakes the type checker and the
// tests cannot see. The Rules of Hooks are the main one — a hook placed after
// an early `return` type-checks, passes every test, and then unmounts the whole
// app at runtime with React error #310 and a blank window. That happened on
// 2026-09-21 (see error.txt); this config is the guard against a repeat.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "src-tauri/**", "node_modules/**", "trash/**", "src/mascot/mascot.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The one that matters here. Never downgrade this to a warning.
      "react-hooks/rules-of-hooks": "error",
      // Useful, but the codebase deliberately omits deps in places where a
      // stale closure is the intended behaviour; those are reviewed by hand.
      "react-hooks/exhaustive-deps": "off",
      // The type checker already covers these, and more precisely.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      // False positives on this codebase: async generators that only return,
      // and a multiline `.then(...)[0]` chain that is valid and intended.
      "require-yield": "off",
      "no-unexpected-multiline": "off",
    },
  },
);
