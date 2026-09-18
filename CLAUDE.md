# CLAUDE.md — Ember

Ember for the desktop (ember-desktop) is the computer edition of the local-first
Ember journaling companion: ember-mobile's features and screens (copied
2026-09-15) with the desktop parts of ember-public put back (tray, Ctrl+Shift+J
capture bar, autostart, Claude subscription), plus a local model that Ember keeps
loaded and a link that syncs with Ember on a phone on the same Wi-Fi. The user drops quick
notes during the day, has a short counselor-style AI conversation in the
evening, and the AI writes the journal entry and tracks patterns over time.
The full product spec is in `DESIGN.md` — read it before any feature work.

## Stack

- Tauri 2 (Rust core) + React 18 + TypeScript (strict) + Vite + Tailwind CSS
- SQLite via tauri-plugin-sql; Recharts for charts
- AI: provider abstraction in `src/ai/` — six providers (list in `ai/providerList.ts`):
  `local` (Ollama through its own /api/chat in `providers/ollama.ts`, or an
  OpenAI-style server such as LM Studio), `cloud` (Groq/Gemini/OpenRouter…),
  `claude-subscription` (the `claude` CLI), `codex-subscription` (the `codex` CLI,
  `src-tauri/src/codex_cli.rs`), `anthropic` and `openai` (API key). A new cloud host must be added to the http
  allowlist in `src-tauri/capabilities/default.json` as well.
- Local model: `src/localModel.ts` + `src-tauri/src/local_model.rs` start Ollama
  if needed, load the chosen model (keep_alive 15m, refreshed every 10 min) and
  unload it on Quit.
- Phone link: `src-tauri/src/lan_server.rs` (server on 47821, discovery on UDP
  47820, pairing, sealing; the chat relay: to Ollama when local, otherwise the
  webview answers with the chosen provider via lan:chat-request / lan_chat_push), `src/lan/desktopLink.ts`
  (answers sync requests), `src/db/sync.ts` + migration 0011 (change log and
  merge rules). `lan_proto.rs`, `db/sync.ts`, `ai/providers/ollama.ts` and
  `lan/syncEvents.ts` are the same file in ember-mobile: change both.
- Wide windows get the sidebar, narrow ones the phone's bottom tabs (App.tsx).

- Context budget (`src/ai/budget.ts`): big models get everything; small ones (local, free hosted,
  phone via computer) get compact mode: `prepare.ts` writes a briefing + checklist, `prompts/counselorCompact.ts`,
  memory lines picked by `relevance.ts` from `memoryFiles.ts`, a rolling chat summary (`window.ts`), and
  Insights in smaller steps (`prompts/extractorCompact.ts`, `compactDays.ts`, counted links in `insights/links.ts`).
  All prompts, filled in, are in `../prompt-review/PROMPTS.md` (regenerate: EMBER_PROMPT_REVIEW=1 npx vitest run
  src/ai/prompts/promptReview.test.ts, desktop). Live small-model check: EMBER_LIVE_OLLAMA=qwen3.5:4b npx vitest run src/ai/liveSmall.test.ts.

## Commands

- `npm run tauri dev` — run the app
- `npm run tauri build` — installers
- `npm run typecheck` — `tsc --noEmit` (must pass before any commit)
- `npm run lint` — eslint

## Layout

```
src/
  ai/          provider layer, prompt builders, context assembly, extraction
  db/          typed data access, migrations — the ONLY place SQL lives
  windows/     main window pages (Today, Journal, Insights, Settings)
  components/  shared UI
  capture/     the Ctrl+Shift+J capture-bar window
  lan/         the phone link
src-tauri/     Rust: tray, hotkey, keychain, migrations, local model, phone link
```

## Hard rules

1. **Local-first & private.** No telemetry, no analytics, no network calls
   except the configured AI endpoint, the update check (one GitHub request
   at launch, switchable off; DESIGN.md §3.5) and the phone link on the home
   network (off until the user pairs; every request sealed with the pairing key,
   src-tauri/src/lan_proto.rs). Never log message content, captures,
   or entries.
   Keys and pairing keys live only in the OS keychain (secret_get/secret_set,
   lan_peers).
2. **SQL only in `src/db/`.** Components call typed functions. Schema changes
   go through numbered migrations — never edit an applied migration.
3. **All model output that must be structured is validated** (zod), retried
   once with the parse error appended, then degraded gracefully. A model
   failure must never lose user data or block saving an entry.
4. **Prompts live in code as exported template functions** in `src/ai/prompts/`,
   one file per job (counselor, journal, extractor, review). They are product
   surface — change them only when asked, and keep DESIGN.md §5 as the source
   of truth for their contracts.
5. **Provider-agnostic:** every AI feature must work on all six providers.
   If a feature relies on a capability one provider lacks, stop and flag it.
6. **Dates:** store ISO 8601 local time; a "day" is the user's local calendar
   day. Session/entry uniqueness is per local date.

## Design language

- A paper journal: warm off-white paper, ink-dark text, the Newsreader serif
  (bundled, never fetched) for headings, entries and Ember's words, the system
  sans for controls. One accent, ember orange-red, used sparingly. Hairline
  rules and spacing instead of boxes; no emoji icons, glows or blur. Colors
  are the named tokens in tailwind.config.js (paper, rule, ink, ember) and the
  validated chart palette in src/components/insights/palette.ts.
- Motion is small and purposeful (page fade-in, ink-in for new messages, the
  breathing ember while Ember thinks) and switches off under reduced motion.
- No gamification noise beyond the small streak counter.
- The capture bar and quick-note sheet must feel instant: no spinners, caret in place at once.
- The journal entry is a handwritten page (Caveat, bundled) on ruled paper;
  papers and their contrast-checked inks live in src/components/paper.ts.
- Empty states are friendly and explain the daily loop in one line.
- Chat renders streaming tokens; never block the UI on a full response.

## Testing expectations

- Vitest for: db access functions (against a temp sqlite file), prompt
  builders (snapshot the assembled context), extractor validation/retry
  logic, streak calculation, observation upsert math.
- UI and Tauri integration are verified manually via each phase's acceptance
  checklist in `CC_BUILD_PROMPTS.md` — say explicitly which items you
  verified and how.

## Plain language
Write replies a smart person outside my field could follow on first read. No jargon, no buzzwords,
no invented compound terms. If a technical term is unavoidable, gloss it in plain words the first
time. Short sentences, one idea each — no nested clauses or hedging chains. Prefer the common word
over the impressive one. Say the thing directly instead of describing that you are about to say it.

## Linux edition (ember-desktop-linux, 2026-09-19)

Copy of ember-desktop with Linux/Arch fixes; see `LINUX.md`. Differences: keyring uses the
Secret Service (Cargo.toml target tables), `src-tauri/src/terminal.rs` opens sign-in terminals,
`--capture` flag for Wayland, tray failure is non-fatal (`TrayReady`), `documents_dir()` fallback,
`packaging/arch/`. Keep other files in step with ember-desktop.
