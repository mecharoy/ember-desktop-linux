# CLAUDE.md — Elytra

Elytra for the desktop (ember-desktop) is the computer edition of the local-first
Elytra journaling companion: ember-mobile's features and screens (copied
2026-09-15) with the desktop parts of ember-public put back (tray, Ctrl+Shift+J
capture bar, autostart, Claude subscription), plus a local model that Elytra keeps
loaded and a link that syncs with Elytra on a phone on the same Wi-Fi. The user drops quick
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
- One layout at every width: the dock along the bottom (App.tsx). The old wide/narrow sidebar split is gone.

- Context budget (`src/ai/budget.ts`): big models get everything; small ones (local, free hosted,
  phone via computer) get compact mode: `prepare.ts` writes a briefing + checklist, `prompts/counselorCompact.ts`,
  memory lines picked by `relevance.ts` from `memoryFiles.ts`, a rolling chat summary (`window.ts`), and
  Insights in smaller steps (`prompts/extractorCompact.ts`, `compactDays.ts`, counted links in `insights/links.ts`).
  All prompts, filled in, are in `../prompt-review/PROMPTS.md` (regenerate: EMBER_PROMPT_REVIEW=1 npx vitest run
  src/ai/prompts/promptReview.test.ts, desktop). Live small-model check: EMBER_LIVE_OLLAMA=qwen3.5:4b npx vitest run src/ai/liveSmall.test.ts.
- Checklist on every provider (fixed 2026-09-20): small models bend the JSON, so `parseChecklist` (ai/agenda.ts) drops bad items and
  trims instead of rejecting the reply, and `extractJson` finds the object inside chatter. `callEndpoint` (providers/openaiCompatible.ts)
  refuses a free-tier job only when the per-minute allowance cuts its reply below min(wanted, 1200); a short job (checklist 600-700,
  chat summary 300) is sent as asked. Tests: providers/jobRoom.test.ts, ai/agenda.test.ts. Same files in all four apps.

## Commands

- `npm run tauri dev` — run the app
- `npm run tauri build` — installers
- `npm run typecheck` — `tsc --noEmit` (must pass before any commit)
- `npm run lint` — eslint. **Not optional.** `rules-of-hooks` is the only
  check that catches a hook placed after an early `return`: that type-checks,
  passes every test, builds clean, and then blanks the whole window at runtime
  with React error #310. It shipped once, on 2026-09-21 (see error.txt).

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

Elytra is a **specimen cabinet**. The app is a dark case; the days are the
pale cards inside it. That is the inversion from Ember, where the app itself
was the paper — and it is why the journal entry keeps its light paper while
everything around it went dark. The entry is the specimen, not the drawer.

Two devices carry it and nothing else has to: the **seam** (a hairline things
part from and close back onto) and the **punctation** (the rows of pits on a
wing case — the dotted rule, the empty-state ground). Both in `src/index.css`.

### Tokens name the ROLE, never the colour

`tailwind.config.js` is the contract. The names stay true in the dark, which
is why they are not "paper" and "ink" any more:

| token | is |
|---|---|
| `ground` | the cabinet floor — the window's base |
| `surface` / `surface-high` | a raised panel, and its hover |
| `line` / `line-strong` | hairlines, the only division the design uses |
| `fg` / `fg-dim` / `fg-faint` | text, three weights |
| `moss` / `moss-bright` / `moss-deep` | the accent |
| `clay` | the rare warm note: a streak, a milestone |
| `paper` | the entry page — light ON PURPOSE, the one thing that is |

Measured on `ground`: fg 13.9:1, fg-dim 9.3:1, fg-faint 5.8:1, moss 7.1:1,
clay 6.7:1. **Moss carries text here**, which it could never do on cream at
2.8:1 — that inversion is the single biggest gain from the dark ground.
Recompute with a contrast script if any value moves.

- **Three typefaces, one job each, all bundled and never fetched.**
  Instrument Serif for page titles, entry titles, big numbers and quotes;
  Epilogue for prose; IBM Plex Mono in small capitals (`.spec`) for section
  labels, dates, counts and keyboard hints. Instrument Serif ships one weight,
  so headings differ by size, never by getting bolder. A light serif blooms on
  a dark ground, so display sizes carry tighter tracking than they did on cream.
- **Who is speaking is never a guess.** Elytra's questions sit in a filled
  `moss-deep` card under an `ELYTRA ASKS` label; what the person wrote is plain
  text on the ground.
- **A day is ONE column, never sub-tabs.** `CounselorChat.tsx` scrolls the whole
  day in the order it happened: the notes, the talk, the entry, divided only by
  a labelled punctation rule (`DaySeam.tsx`). The composer is pinned under it.
  Ember had Notes / Talk / Journal as sub-tabs inside a page while "Journal" was
  ALSO a top-level tab meaning the archive — the same word twice, and two
  navigations to reach one day. Do not reintroduce a tab strip inside a day.
- **The Journal is a drawer of cards** (`.page-card`): each entry is a card of
  its own paper, in its own hand, lying at its own slight angle, showing two
  lines of the writing. A date alone never tells one day from another. The
  calendar is an OVERLAY you hold up and put away, not a panel that shoves the
  drawer down the page.
- **The beetle answers when tapped** (`mascot/companion.ts`): a line about where
  the day has got to, chosen from the day's state crossed with the time of day,
  read straight out of the database. No model call, no network, no spinner —
  so it works offline and cannot invent anything about the person's day. It
  deliberately quotes nobody: an unverifiable quotation in a journal is worse
  than no quotation.
- **The dock is the whole of the navigation** (`components/Dock.tsx`, the same
  file in both apps). One floating bar along the bottom on every window size
  and both platforms: four plates, seam, note button. There is no sidebar and
  no wide/narrow split. Every plate is a fixed 52px whether or not it is the
  one you are on, and the name opens DOWNWARD inside that width; a plate that
  grows sideways shuffles its neighbours out from under the finger that just
  pressed it (see error.txt, 2026-09-21).
- **Nav icons are drawn at 21px and looked at before they are kept.** That is
  the only size they ship at, and shapes lie at large sizes: a circle with a
  stem on top reads as a POWER button, and anything impaled on a pin turns to
  mush. Render candidates side by side at 21px; do not judge them at 56px.
- **One mascot, one place**, in `src/mascot/`: its own round perch (`Perch` in
  `Dock.tsx`), beside the dock on a phone and alone in the bottom-left corner
  of a wide window at ~70px — moved out of the dock on 2026-09-23 at the
  user's request so its expressions can be seen. Nothing drives it directly:
  work claims a state through `mascot/pulse.ts` and releases it. States in use:
  idle, sleeping (90 s still), listening (typing anywhere, `mascot/typing.ts`,
  and hover), thinking (a pause mid-typing, or a model working), flying
  (preparing the day; a short flight on every page change, App.tsx), loading
  (Patterns re-read), saving (flash on save), celebrate (streak of 7s, and
  closing a recap that was watched to the end). **It must be mounted with
  `theme: "dark"`**. The kit freezes every loop under reduced motion.
- **The beetle's card** says where the day is (one line, `companion.ts`) and,
  under it, one finding FROM PATTERNS (`insightLines`, built from
  `insights/recap.ts`, same one all day). Counted on the device, no model call.
- **Patterns is chaptered** (`windows/Insights.tsx`): a recap card (the one
  thing to press), three vitals, a jump bar, then Mood / Your days / Body &
  rhythm / Mind / Letters & ideas, and "Still gathering" last for every
  section without enough days. Upkeep (Refresh, Re-read all) lives behind ⋯;
  background errors are one line with Details. The recap (`Recap.tsx`) is a
  full-screen slideshow in four fixed brand tones, one hero per slide,
  portalled to `document.body` (an animated page traps fixed children).
- **Patterns stays current** (`insights/stats.ts`): lists drop what has not
  come up for `STALE_AFTER_DAYS` (30) — people and themes keep a quiet
  "N not mentioned in the last month" line; comparisons (movers, weekday
  rhythm, activities) count `ANALYSIS_DAYS` (90); thinking traps need one
  day in the last 8 weeks; feelings default to 4 weeks; suggestions say when
  they are over a month old.
- **Ground pattern**: `components/Mycelium.tsx`, a seeded fungal network
  spreading from the corners, masked out of the reading column, moss at
  `--mycelium-alpha`.
- **Logo** (2026-09-23, user's pick): the dock's Today icon as the app mark — a
  head and two wing cases parted at the seam, one continuous line. App icon =
  moss-bright line on an ink tile; notification, widget and themed icons = the
  same line alone. The paths live once in `../elytra-refine-2026-09-23/logo/
  round3/mark.py`, which writes every icon; if `NavIcon('today')` in Dock.tsx is
  redrawn, regenerate the logo from it (and the film ending, film/v9).
- **Two themes, one set of class names.** The palette is CSS variables in
  `src/index.css` (dark and `[data-theme="light"]`); `src/theme.ts` sets the
  attribute and is the ONLY thing that may know which theme is on. Components
  never branch on it — if something has to differ, it needs a token, not an
  `if`. Two exceptions, both because they paint themselves rather than
  inheriting: the vendored mascot kit (`mascot/Beetle.tsx` sets its own
  `data-theme`) and the chart palette (`insights/palette.ts`, which swaps sets
  and is why `windows/Insights.tsx` re-renders on a theme change).
- **`surface` means RAISED, not lighter.** It is darker than the ground in the
  dark theme and lighter in the light one. Never hard-code a direction.
- **Two tokens do not flip.** `speak` / `speak-fg` are the green card Elytra's
  questions sit in and the pale ink on it — the same object in both themes,
  which is why that card cannot be built from `moss-deep` + `fg`. And the modal
  scrim is dark in both: that is the room going dim, not the palette inverting.
- **The accent was re-chosen for light, not lightened.** `#7fb27c` reads 7.1:1
  on the dark ground and 2.8:1 on cream, so the light theme uses `#33512f`
  (7.9:1). The same trap caught the charts once already. Both palettes are
  scripted, not eyeballed; the measured numbers sit beside the values.
- **"They already have it" needs an expiry.** `sync_changes.origin` stops a row
  echoing back to whoever wrote it, but the tag is permanent while the claim is
  not: a device that is reinstalled, cleared or restored loses rows it wrote,
  and those are then invisible to the sync on both sides. `forgetPeerOrigin()`
  drops a peer's tags as soon as it asks from revision 0. Do not add another
  suppression rule without asking what happens when the peer loses its copy.
- **A Tauri command taking binary data must accept both IPC shapes.**
  `InvokeBody::Raw` only arrives over the custom-protocol IPC. Android never
  uses it, and desktop abandons it permanently after one failure, falling back
  to postMessage where a `Uint8Array` arrives as a JSON array of numbers. See
  `picked_bytes()` in `src-tauri/src/lib.rs` — restoring a backup could not
  work on Android at all until that was fixed (error.txt, 2026-09-22).
- **A className is just a string.** Nothing in the toolchain catches a class
  that matches no rule — it type-checks, lints, tests and builds, and the page
  silently loses its styling. After any scripted rename, diff the classes
  defined in `index.css` against the classes used in the components, in both
  directions. That is how the journal entry lost its paper (error.txt).
- **Motion is landing and folding shut.** `alight`, `part-open`, `ink-in`, the
  wingbeat. All off under reduced motion.
- **On dark, hover LIFTS toward the light.** Never darken a hover state here.
- No emoji icons, glows or blur. Hairlines and spacing instead of boxes.
- The journal entry is a handwritten page (Caveat, bundled) on ruled paper;
  papers and their contrast-checked inks live in `src/components/paper.ts`.
  Its shadow is heavy on purpose: a pale card must look like it sits ON the
  ground, not like a hole cut in it.
- Charts use the validated palette in `src/components/insights/palette.ts`.
  **These are dark-mode steps, chosen — not the light palette inverted.** The
  old light pair re-measured at 2.87:1 on the dark surface, under the floor.
- Empty states are friendly and explain the daily loop in one line.
- Chat renders streaming tokens; never block the UI on a full response.

## Linux edition (elytra-desktop-linux, 2026-09-23)

`elytra-desktop` plus the Linux fixes first made for ember-desktop-linux (2026-09-19); see
`LINUX.md`. Differences: keyring uses the Secret Service (Cargo.toml target tables),
`src-tauri/src/terminal.rs` opens sign-in terminals, `--capture` flag for Wayland, tray failure
is non-fatal (`TrayReady`), `documents_dir()` fallback, WEBKIT_DISABLE_DMABUF_RENDERER in
main.rs, update source = mecharoy/ember-desktop-linux, `packaging/arch/` (package, binary and
icon keep the name `ember-desktop` so an installed Ember upgrades in place). This folder is the
git working tree of github.com/mecharoy/ember-desktop-linux. Keep every other file in step with
elytra-desktop. It cannot be built on this Windows PC or the SSH servers: the GitHub Actions
workflows build and test it (linux-build on push to main, release on a v* tag).

## Names that must not change

The rename touched display names only. These are load-bearing and stay:
`dev.abhij.ember.*` (the Tauri identifier and the Android package),
`ember.db` and the files beside it, the crate names `ember-desktop` /
`ember-mobile`, the LAN protocol strings, the Android intent actions and
SharedPreferences keys, and `window.__emberBackupPicked`. Moving any of them
loses a person's journal or breaks phone pairing. The backup folder did move
to `Documents/Elytra`; `backup_folder` in `src-tauri/src/lib.rs` still opens
the old `Documents/Ember` when that is the only one there.

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
