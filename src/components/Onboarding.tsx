import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { localDateKey, localStamp } from "../time";
import { setProfileSummary } from "../db/profile";
import { composeSeedProfile } from "../db/profileSeed";
import { getAllSettings, setSetting } from "../db/settings";
import { CLOUD_PRESETS, presetForBaseUrl } from "../ai/providers/cloud";
import { ANTHROPIC_KEYS_URL } from "../ai/providers/anthropic";
import KeyLink from "./KeyLink";
import { setApiKey, setCloudApiKey, setOpenAiKey } from "../secrets";
import { PROVIDER_OPTIONS } from "../ai/providerList";
import { DEFAULT_OPENAI_MODEL, OPENAI_KEYS_URL } from "../ai/providers/openai";
import { ensureNotificationPermission } from "../scheduler";
import { SCIENCE_HIGHLIGHTS } from "../insights/science";
import { claimJournal } from "../install";
import RestoreBackup from "./RestoreBackup";
import StylePicker from "./StylePicker";
import { DEFAULT_STYLE, type ConversationStyle } from "../ai/prompts/style";
import { captureHotkeyLabel } from "../platform";
import Beetle from "../mascot/Beetle";

const PROVIDERS = PROVIDER_OPTIONS;

/** Getting-to-know-you questions (step 2). Each answer maps to a context
 * layer the counselor actually uses: routine, people, open threads, goals and
 * coping style. How Elytra should talk is picked above them (StylePicker).
 * Labels are third-person because the profile is injected into the counselor
   prompt as "About them: {profile_summary}". All optional. */
const QUESTIONS = [
  {
    label: "A typical day",
    prompt: "What does an ordinary day look like for you right now?",
    placeholder: "Work, study, routines, whatever fills most days",
  },
  {
    label: "People who matter",
    prompt: "Who are the important people in your life at the moment?",
    placeholder: "Names help. Elytra will recognise them when they come up",
  },
  {
    label: "Currently weighing on them",
    prompt: "What's been weighing on you lately?",
    placeholder: "The thing that keeps taking up space in your head",
  },
  {
    label: "Working toward",
    prompt: "What are you working toward, or hoping looks different a year from now?",
    placeholder: "A goal, a change, a hope",
  },
  {
    label: "On hard days",
    prompt: "When a day goes badly, how do you usually cope?",
    placeholder: "What helps, what you tend to do",
  },
] as const;

function Wordmark({ size, mark = true }: { size: "large" | "medium"; mark?: boolean }) {
  const large = size === "large";
  return (
    <div className="flex items-center gap-3">
      {mark && (
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`select-none rounded-[10px] ${large ? "h-11 w-11" : "h-9 w-9"}`}
        />
      )}
      <span className={`font-serif leading-none tracking-[-0.015em] text-fg ${large ? "text-[52px]" : "text-[34px]"}`}>
        Elytra
      </span>
    </div>
  );
}

/**
 * The film (public/intro.mp4), over the whole screen, once. It ends on the
 * mark and the name, which is where the app picks up — so when it finishes it
 * dissolves rather than shrinking into a card. Skip appears after a second,
 * and a person who has asked for less motion never sees it at all.
 *
 * Without the file, or if playback fails, the page shows at once.
 *
 * Exported because first run is the only time it plays by itself: anyone who
 * already had a journal when they upgraded would otherwise never see the film
 * that ships inside the app. Settings can ask for it.
 */
export function IntroFilm({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSkip, setShowSkip] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    // Matches the fade below. A timer, not transitionend: the event never
    // arrives while the window is in the background, and the film must not
    // be able to trap the app behind it.
    setTimeout(onDone, 520);
  }

  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // A long film can't be the only way in: Escape ends it too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[60] bg-ground-deep transition-opacity duration-500 ${leaving ? "opacity-0" : "opacity-100"}`}
      style={{ pointerEvents: leaving ? "none" : undefined }}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        src="/intro.mp4"
        autoPlay
        muted
        playsInline
        onEnded={finish}
        onError={finish}
      />
      {showSkip && (
        <button
          onClick={finish}
          className="fade-in absolute bottom-6 right-6 rounded-full border border-fg/25 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-fg/70 transition-colors hover:border-fg/50 hover:text-fg"
        >
          Skip
        </button>
      )}
    </div>
  );
}

/** First-run page: the daily loop in three lines, a name, a
 * reminder time, a provider — then an optional second step of
 * get-to-know-you questions that seed the AI's profile so the first evening
 * conversation is already personal. "Skip" stays a first-class exit at both
   steps. */
export default function Onboarding({ onDone, welcomeBack = false }: { onDone: () => void; welcomeBack?: boolean }) {
  const [name, setName] = useState("");
  const [time, setTime] = useState("21:30");
  const [usual, setUsual] = useState({ lunch: "13:00", break: "17:30", dinner: "20:30" });
  const [provider, setProvider] = useState<string>("cloud");
  const [presetId, setPresetId] = useState(CLOUD_PRESETS[0].id);
  const [key, setKey] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"intro" | "setup" | "questions">(welcomeBack ? "setup" : "intro");
  const [answers, setAnswers] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const [style, setStyle] = useState<ConversationStyle>(DEFAULT_STYLE);
  // The film plays over the first screen, once, and is gone after that.
  const [filmPlaying, setFilmPlaying] = useState(
    () => !welcomeBack && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // Welcome back: what the restored journal already had, so the form starts
  // filled in and an unchanged service keeps its own model settings.
  const [restored, setRestored] = useState<{ provider: string; presetId: string } | null>(null);

  const preset = CLOUD_PRESETS.find((p) => p.id === presetId) ?? CLOUD_PRESETS[0];

  useEffect(() => {
    if (!welcomeBack) return;
    getAllSettings().then((s) => {
      const restoredPreset = presetForBaseUrl(s.cloud_api_base) ?? CLOUD_PRESETS[0];
      setName(s.user_name);
      setTime(s.reminder_time);
      setUsual({ lunch: s.usual_lunch, break: s.usual_break, dinner: s.usual_dinner });
      setProvider(PROVIDERS.some((p) => p.id === s.provider) ? s.provider : "cloud");
      setLocalModel(s.provider === "local" ? s.model : "");
      setPresetId(restoredPreset.id);
      setRestored({ provider: s.provider, presetId: restoredPreset.id });
    });
  }, [welcomeBack]);

  /** What the chosen provider needs saved. */
  function providerSettings(sameService: boolean): Promise<void>[] {
    switch (provider) {
      case "cloud":
        return [
          setCloudApiKey(key.trim()),
          ...(sameService
            ? []
            : [
                setSetting("cloud_api_base", preset.baseUrl),
                setSetting("model", preset.model),
                setSetting("cloud_max_tokens", String(preset.maxTokens)),
              ]),
        ];
      case "local":
        return [setSetting("local_server", "ollama"), setSetting("model", localModel.trim())];
      case "claude-subscription":
        return sameService ? [] : [setSetting("model", "claude-sonnet-5")];
      case "openai":
        return [setOpenAiKey(key.trim()), ...(sameService ? [] : [setSetting("model", DEFAULT_OPENAI_MODEL)])];
      case "codex-subscription":
        return sameService ? [] : [setSetting("model", "")];
      default:
        return [setApiKey(key.trim()), ...(sameService ? [] : [setSetting("model", "claude-sonnet-5")])];
    }
  }

  /** Welcome back exit: the journal is already set up, so only what changed
      is written, and there are no questions to ask. */
  async function finishWelcomeBack(save: boolean) {
    setSaving(true);
    if (save) {
      const sameService = restored?.provider === provider && (provider !== "cloud" || restored?.presetId === presetId);
      await Promise.all([
        setSetting("user_name", name.trim()),
        setSetting("reminder_time", time),
        setSetting("usual_lunch", usual.lunch),
        setSetting("usual_break", usual.break),
        setSetting("usual_dinner", usual.dinner),
        setSetting("provider", provider),
        ...providerSettings(sameService),
      ]);
      await emit("settings:saved");
    }
    await claimJournal();
    await ensureNotificationPermission();
    onDone();
  }

  /** Step 1 exit. "Set up later" skips everything; saving moves on to the
     get-to-know-you questions instead of closing. */
  async function finish(save: boolean) {
    if (welcomeBack) return finishWelcomeBack(save);
    setSaving(true);
    if (!save) {
      await setSetting("onboarded", "1");
      await ensureNotificationPermission();
      onDone();
      return;
    }
    await Promise.all([
      setSetting("user_name", name.trim()),
      setSetting("reminder_time", time),
      setSetting("usual_lunch", usual.lunch),
      setSetting("usual_break", usual.break),
      setSetting("usual_dinner", usual.dinner),
      setSetting("provider", provider),
      ...providerSettings(false),
    ]);
    // Starts Ollama and loads the model in the background while the questions show.
    await emit("settings:saved");
    setSaving(false);
    setStep("questions");
  }

  /** Step 2 exit. Answered questions seed the profile table so the very
 *   first counselor session already knows the person; skipping leaves the
     profile empty, exactly as before this step existed. */
  async function finishQuestions(save: boolean) {
    setSaving(true);
    // The style picks count either way: they're preselected, not questions.
    await Promise.all([
      setSetting("conversation_tone", style.tone),
      setSetting("conversation_approach", style.approach),
    ]);
    if (save) {
      const summary = composeSeedProfile(
        name,
        QUESTIONS.map((q, i) => ({ label: q.label, text: answers[i] })),
        localDateKey(),
      );
      if (summary) await setProfileSummary(summary, localStamp());
    }
    await setSetting("onboarded", "1");
    // Some systems ask once whether Elytra may show the evening reminder.
    await ensureNotificationPermission();
    onDone();
  }

  if (step === "intro") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-ground">
        {filmPlaying && <IntroFilm onDone={() => setFilmPlaying(false)} />}
        <div key="intro" className="page mx-auto flex min-h-full max-w-[600px] flex-col px-6 pb-10 pt-12">
          <div className="flex items-center gap-4">
            <Beetle size={68} state="idle" />
            <div>
              <Wordmark size="large" mark={false} />
              <p className="spec mt-3">Write it down. Let it open.</p>
            </div>
          </div>
          <span className="seam-rule mt-7" aria-hidden="true" />

          <h1 className="mt-7 font-serif text-[30px] leading-[1.1] tracking-[-0.012em] text-fg">
            Your days, read closely.
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-fg-dim">
            You write a line when something happens. In the evening Elytra asks about it, then writes the day up
            and keeps what it learns. Everything below is where the reading comes from.
          </p>

          <ul className="mt-6 flex flex-col divide-y divide-line border-y border-line">
            {SCIENCE_HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex flex-col gap-1 py-3.5">
                <span className="spec-strong">{h.title}</span>
                <span className="text-[13.5px] leading-snug text-fg-dim">{h.line}</span>
              </li>
            ))}
          </ul>

          <button onClick={() => setStep("setup")} className="btn-primary mt-8">
            Set it up
          </button>
          <div className="mt-2 flex flex-col text-center">
            <RestoreBackup label="Been here before? Restore a backup" buttonClass="btn-ghost" />
          </div>
          <p className="hint text-center">
            Elytra on a phone too? Pair them later in Settings &rsaquo; Sync with phone.
          </p>
        </div>
      </div>
    );
  }

  if (step === "questions") {
    const answered = answers.filter((a) => a.trim()).length;
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-ground">
        <div key="questions" className="page mx-auto flex min-h-full max-w-[580px] flex-col justify-center px-6 py-10">
          <Wordmark size="medium" />
          <h1 className="mt-6 font-serif text-[26px] leading-tight text-fg">
            Help Elytra get to know you{name.trim() ? `, ${name.trim()}` : ""}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-fg-dim">
            How should Elytra talk with you? You can change this later in Settings.
          </p>

          <div className="mt-6">
            <StylePicker
              tone={style.tone}
              approach={style.approach}
              onTone={(tone) => setStyle((s) => ({ ...s, tone }))}
              onApproach={(approach) => setStyle((s) => ({ ...s, approach }))}
            />
          </div>

          <p className="mt-8 border-t border-line pt-6 text-[13.5px] leading-relaxed text-fg-dim">
            Then five questions, all optional. What you answer shapes the very first conversation instead of it
            starting cold. The answers stay on this computer.
          </p>

          <div className="mt-5 flex flex-col gap-5">
            {QUESTIONS.map((q, i) => (
              <label key={q.label} className="flex flex-col gap-1.5">
                <span className="font-serif text-[19px] leading-snug text-fg">{q.prompt}</span>
                <textarea
                  className="input resize-none"
                  rows={2}
                  maxLength={240}
                  value={answers[i]}
                  placeholder={q.placeholder}
                  onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
                />
              </label>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-stretch gap-2">
            <button onClick={() => finishQuestions(true)} disabled={saving} className="btn-primary">
              {saving ? "Saving…" : answered > 0 ? "Open the journal" : "Open it without answering"}
            </button>
            <button onClick={() => finishQuestions(false)} disabled={saving} className="btn-ghost">
              Skip &mdash; it will pick this up as you go
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ground">
      <div className="page mx-auto flex min-h-full max-w-[580px] flex-col justify-center px-6 py-10">
        {welcomeBack ? (
          <>
            <Wordmark size="medium" />
            <h1 className="mt-6 font-serif text-[28px] leading-tight tracking-[-0.015em] text-fg">
              Welcome back{name.trim() ? `, ${name.trim()}` : ""}
            </h1>
            <p className="mt-2 border-b border-line pb-5 text-[15px] leading-relaxed text-fg-dim">
              Your journal is back. A backup never holds API keys, so check the provider below before you carry on.
            </p>
          </>
        ) : (
          <>
            <Wordmark size="large" />
            <p className="spec mt-4">Write it down. Let it open.</p>

            <ol className="mt-7 flex flex-col gap-4 border-y border-line py-5 text-[15px] leading-relaxed text-fg-dim">
              <li className="flex gap-4">
                <span className="mt-[3px] w-5 shrink-0 font-mono text-[11px] tracking-[0.1em] text-moss">01</span>
                <span>Press {captureHotkeyLabel()} anywhere during the day and write the line. It takes five seconds.</span>
              </li>
              <li className="flex gap-4">
                <span className="mt-[3px] w-5 shrink-0 font-mono text-[11px] tracking-[0.1em] text-moss">02</span>
                <span>In the evening Elytra asks about those lines. You answer; it does the writing.</span>
              </li>
              <li className="flex gap-4">
                <span className="mt-[3px] w-5 shrink-0 font-mono text-[11px] tracking-[0.1em] text-moss">03</span>
                <span>The day goes down by hand on the paper you choose, and what keeps coming back shows up under Patterns.</span>
              </li>
            </ol>
          </>
        )}

        <div className="mt-7 flex flex-col gap-5">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="label">What should it call you?</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </label>
            <label className="flex w-32 flex-col gap-1.5">
              <span className="label">Daily reminder</span>
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="label">When do you usually have these?</span>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ["lunch", "Lunch"],
                  ["break", "A break"],
                  ["dinner", "Dinner"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1 text-[12px] text-fg-faint">
                  {label}
                  <input
                    type="time"
                    className="input w-full"
                    value={usual[k]}
                    onChange={(e) => setUsual((u) => ({ ...u, [k]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <span className="hint">Your day is split at these times in the check-in.</span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="label">AI provider</span>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="AI provider">
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="hint">{PROVIDERS.find((p) => p.id === provider)?.blurb}</span>

            {provider === "cloud" && (
              <label className="mt-1 flex flex-col gap-1.5">
                <span className="label">Service</span>
                <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {CLOUD_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  Get a key at <KeyLink url={preset.keysUrl} />.
                </span>
              </label>
            )}

            {provider === "local" && (
              <label className="mt-1 flex flex-col gap-1.5">
                <span className="label">Model</span>
                <input
                  className="input"
                  autoCapitalize="off"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  placeholder="qwen3.5:4b"
                />
                <span className="hint">A model downloaded in Ollama.</span>
              </label>
            )}

            {(provider === "claude-subscription" || provider === "codex-subscription") && (
              <p className="hint mt-1">
                Sign in to {provider === "claude-subscription" ? "Claude Code" : "Codex"} later in Settings &rsaquo; AI provider.
              </p>
            )}

            {(provider === "cloud" || provider === "anthropic" || provider === "openai") && (
            <label className="mt-1 flex flex-col gap-1.5">
              <span className="label">API key</span>
              <input
                type="password"
                autoComplete="off"
                className="input"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider === "cloud" ? "Paste your key" : provider === "openai" ? "sk-..." : "sk-ant-..."}
              />
              <span className="hint">
                {provider === "anthropic" && (
                  <>
                    Get a key at <KeyLink url={ANTHROPIC_KEYS_URL} />.{" "}
                  </>
                )}
                {provider === "openai" && (
                  <>
                    Get a key at <KeyLink url={OPENAI_KEYS_URL} />.{" "}
                  </>
                )}
                You can also add it later in Settings.
              </span>
            </label>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-col items-stretch gap-2">
          <button onClick={() => finish(true)} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : welcomeBack ? "Continue" : "Next"}
          </button>
          <button onClick={() => finish(false)} disabled={saving} className="btn-ghost">
            {welcomeBack ? "Do it later" : "Set up later"}
          </button>
        </div>

      </div>
    </div>
  );
}
