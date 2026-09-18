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

const PROVIDERS = PROVIDER_OPTIONS;

/** Getting-to-know-you questions (step 2). Each answer maps to a context
 * layer the counselor actually uses: routine, people, open threads, goals and
 * coping style. How Ember should talk is picked above them (StylePicker).
 * Labels are third-person because the profile is injected into the counselor
 * prompt as "About them: {profile_summary}". All optional. */
const QUESTIONS = [
  {
    label: "A typical day",
    prompt: "What does an ordinary day look like for you right now?",
    placeholder: "Work, study, routines, whatever fills most days",
  },
  {
    label: "People who matter",
    prompt: "Who are the important people in your life at the moment?",
    placeholder: "Names help. Ember will recognise them when they come up",
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

function Wordmark({ size }: { size: "large" | "medium" }) {
  const large = size === "large";
  return (
    <div className="flex items-center gap-3">
      <img
        src="/logo-mark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`select-none ${large ? "h-12 w-12" : "h-9 w-9"}`}
      />
      <span className={`font-serif leading-none tracking-[-0.03em] text-ink ${large ? "text-[48px]" : "text-[32px]"}`}>
        Ember
      </span>
    </div>
  );
}

type Box = { top: number; left: number; width: number; height: number };

/** The intro clip (public/intro.mp4). It first plays over the whole screen;
 *  when it ends (or on Skip) it shrinks into its card at the top of the page
 *  and keeps looping there, and `onSettled` lets the page show its text.
 *  Without the file, the wordmark stands in and the page shows at once. */
function IntroVideo({ scrollerRef, onSettled }: { scrollerRef: React.RefObject<HTMLDivElement | null>; onSettled: () => void }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<"full" | "shrinking" | "card">(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "card" : "full",
  );
  const [box, setBox] = useState<Box | null>(null);

  // Where the card sits inside the scrolling page.
  const slotBox = (): Box | null => {
    const slot = slotRef.current;
    const page = scrollerRef.current;
    if (!slot || !page) return null;
    const s = slot.getBoundingClientRect();
    const p = page.getBoundingClientRect();
    return { top: s.top - p.top + page.scrollTop, left: s.left - p.left, width: s.width, height: s.height };
  };

  function shrink() {
    if (phase !== "full") return;
    setBox(slotBox());
    setPhase("shrinking");
  }

  useEffect(() => {
    if (failed && phase === "full") setPhase("card");
    // transitionend never comes if the page isn't drawn meanwhile (app in
    // the background), so the text can't be left hidden.
    if (phase !== "shrinking") return;
    const timer = setTimeout(() => setPhase("card"), 900);
    return () => clearTimeout(timer);
  }, [failed, phase]);

  useEffect(() => {
    if (phase !== "card") return;
    setBox(slotBox());
    onSettled();
    const video = videoRef.current;
    if (video) {
      video.loop = true;
      if (video.ended || video.paused) video.play().catch(() => {});
    }
    const onResize = () => setBox(slotBox());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [phase]);

  const full = phase === "full";
  const style: React.CSSProperties = full || !box
    ? { top: 0, left: 0, width: "100%", height: "100%" }
    : { top: box.top, left: box.left, width: box.width, height: box.height };

  return (
    <>
      {/* Holds the card's place in the page; the clip lands on top of it. */}
      <div ref={slotRef} className="aspect-[4/5] w-full" aria-hidden="true" />
      <div
        style={{
          ...style,
          transition: phase === "shrinking" ? "top 700ms cubic-bezier(.4,0,.2,1), left 700ms cubic-bezier(.4,0,.2,1), width 700ms cubic-bezier(.4,0,.2,1), height 700ms cubic-bezier(.4,0,.2,1), border-radius 700ms" : undefined,
        }}
        onTransitionEnd={(e) => {
          if (e.propertyName === "height" && phase === "shrinking") setPhase("card");
        }}
        className={`absolute z-10 overflow-hidden bg-paper-deep ${full ? "rounded-none" : "rounded-2xl border border-rule"}`}
      >
        {!failed && (
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            src="/intro.mp4"
            autoPlay
            muted
            playsInline
            onEnded={shrink}
            onError={() => setFailed(true)}
          />
        )}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Wordmark size="large" />
            <p className="font-serif text-[18px] italic text-ink-soft">A journal that writes itself.</p>
          </div>
        )}
        {full && !failed && (
          <button onClick={shrink} className="btn-ghost absolute right-3 top-3">
            Skip
          </button>
        )}
      </div>
    </>
  );
}

/** First-run page: the daily loop in three lines, a name, a
 * reminder time, a provider — then an optional second step of
 * get-to-know-you questions that seed the AI's profile so the first evening
 * conversation is already personal. "Skip" stays a first-class exit at both
 * steps. */
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
  const introScrollerRef = useRef<HTMLDivElement>(null);
  // The intro text waits until the clip has shrunk into its card.
  const [introSettled, setIntroSettled] = useState(false);
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
   *  is written, and there are no questions to ask. */
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
   * get-to-know-you questions instead of closing. */
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
   * first counselor session already knows the person; skipping leaves the
   * profile empty, exactly as before this step existed. */
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
    // Some systems ask once whether Ember may show the evening reminder.
    await ensureNotificationPermission();
    onDone();
  }

  if (step === "intro") {
    return (
      <div ref={introScrollerRef} className={`fixed inset-0 z-50 bg-paper ${introSettled ? "overflow-y-auto" : "overflow-hidden"}`}>
        {/* No .page animation here: its transform would make this box, not the
            scroller, the frame the full-screen clip is positioned in. */}
        <div key="intro" className="mx-auto flex min-h-full max-w-[580px] flex-col px-6 pb-8 pt-6">
          <IntroVideo scrollerRef={introScrollerRef} onSettled={() => setIntroSettled(true)} />

          <div
            className={`flex flex-col transition-opacity duration-500 ${introSettled ? "opacity-100" : "pointer-events-none opacity-0"}`}
            aria-hidden={!introSettled}
          >
          <h1 className="mt-7 font-serif text-[28px] leading-tight tracking-[-0.015em] text-ink">
            Your days, read closely.
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            Every Insight Ember draws is modelled on methods from psychology research and therapy.
          </p>

          <ul className="mt-5 flex flex-col divide-y divide-rule border-y border-rule">
            {SCIENCE_HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex flex-col gap-0.5 py-3">
                <span className="font-serif text-[17px] text-ink">{h.title}</span>
                <span className="text-[13.5px] leading-snug text-ink-faint">{h.line}</span>
              </li>
            ))}
          </ul>

          <button onClick={() => setStep("setup")} className="btn-primary mt-8">
            Get started
          </button>
          <div className="mt-2 flex flex-col text-center">
            <RestoreBackup label="Used Ember before? Restore your backup" buttonClass="btn-ghost" />
          </div>
          <p className="hint text-center">Using Ember on your phone? Pair it later in Settings &rsaquo; Sync with phone.</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "questions") {
    const answered = answers.filter((a) => a.trim()).length;
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
        <div key="questions" className="page mx-auto flex min-h-full max-w-[580px] flex-col justify-center px-6 py-10">
          <Wordmark size="medium" />
          <h1 className="mt-6 font-serif text-[26px] leading-tight text-ink">
            Help Ember get to know you{name.trim() ? `, ${name.trim()}` : ""}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            How should Ember talk with you? You can change this later in Settings.
          </p>

          <div className="mt-6">
            <StylePicker
              tone={style.tone}
              approach={style.approach}
              onTone={(tone) => setStyle((s) => ({ ...s, tone }))}
              onApproach={(approach) => setStyle((s) => ({ ...s, approach }))}
            />
          </div>

          <p className="mt-8 border-t border-rule pt-6 text-[13.5px] leading-relaxed text-ink-soft">
            A few personal questions, all optional. Your answers shape how Ember talks with you from the first
            conversation, and they&rsquo;re stored on this computer.
          </p>

          <div className="mt-5 flex flex-col gap-5">
            {QUESTIONS.map((q, i) => (
              <label key={q.label} className="flex flex-col gap-1.5">
                <span className="font-serif text-[16px] text-ink">{q.prompt}</span>
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
              {saving ? "Saving…" : answered > 0 ? "Start journaling" : "Start without answering"}
            </button>
            <button onClick={() => finishQuestions(false)} disabled={saving} className="btn-ghost">
              Skip. Ember will learn as you go
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
      <div className="page mx-auto flex min-h-full max-w-[580px] flex-col justify-center px-6 py-10">
        {welcomeBack ? (
          <>
            <Wordmark size="medium" />
            <h1 className="mt-6 font-serif text-[28px] leading-tight tracking-[-0.015em] text-ink">
              Welcome back{name.trim() ? `, ${name.trim()}` : ""}
            </h1>
            <p className="mt-2 border-b border-rule pb-5 text-[15px] leading-relaxed text-ink-soft">
              Your journal is back. Backups don&rsquo;t keep API keys, so check the AI provider to pick up where you left off.
            </p>
          </>
        ) : (
          <>
            <Wordmark size="large" />
            <p className="mt-3 font-serif text-[20px] italic text-ink-soft">A journal that writes itself.</p>

            <ol className="mt-7 flex flex-col gap-3 border-y border-rule py-5 text-[15px] leading-relaxed text-ink-soft">
              <li className="flex gap-4">
                <span className="w-3 font-serif text-[18px] italic text-ember">1</span>
                <span>During the day, press {captureHotkeyLabel()} anywhere and jot down what happened. Five seconds.</span>
              </li>
              <li className="flex gap-4">
                <span className="w-3 font-serif text-[18px] italic text-ember">2</span>
                <span>Later in the day, Ember starts a short conversation about it. You just answer.</span>
              </li>
              <li className="flex gap-4">
                <span className="w-3 font-serif text-[18px] italic text-ember">3</span>
                <span>Ember writes the journal entry by hand on the paper you pick, and learns your patterns over time.</span>
              </li>
            </ol>
          </>
        )}

        <div className="mt-7 flex flex-col gap-5">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="label">What should Ember call you?</span>
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
                <label key={k} className="flex flex-col gap-1 text-[12px] text-ink-faint">
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
            {saving ? "Saving…" : welcomeBack ? "Continue" : "Start journaling"}
          </button>
          <button onClick={() => finish(false)} disabled={saving} className="btn-ghost">
            {welcomeBack ? "Do it later" : "Set up later"}
          </button>
        </div>

      </div>
    </div>
  );
}
