import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getAllSettings, setSetting } from "../db/settings";
import type { SettingKey } from "../db/types";
import { exportEverything, deleteEverything } from "../db/exporter";
import { getApiKey, setApiKey, getCloudApiKey, setCloudApiKey, getOpenAiKey, setOpenAiKey } from "../secrets";
import { DEFAULT_OPENAI_MODEL, OPENAI_KEYS_URL, createOpenAiProvider } from "../ai/providers/openai";
import { PROVIDER_OPTIONS, isKnownProvider } from "../ai/providerList";
import CodexSetup from "../components/settings/CodexSetup";
import WritingStyle from "../components/WritingStyle";
import { ANTHROPIC_KEYS_URL, createAnthropicProvider } from "../ai/providers/anthropic";
import { CLOUD_PRESETS, createCloudProvider } from "../ai/providers/cloud";
import { ProviderError } from "../ai/types";
import { getProvider } from "../ai/factory";
import ClaudeSubscriptionSetup from "../components/settings/ClaudeSubscriptionSetup";
import LocalModelSetup from "../components/settings/LocalModelSetup";
import PhoneLinkSettings from "../components/settings/PhoneLinkSettings";
import { captureHotkeyLabel } from "../platform";
import DocumentsManager from "../components/DocumentsManager";
import type { Instrument } from "../db/types";
import UpdatesAndFeedback from "../components/UpdatesAndFeedback";
import StylePicker from "../components/StylePicker";
import { parseStyle } from "../ai/prompts/style";
import KeyLink from "../components/KeyLink";
import { PaperPicker } from "../components/EntryFields";
import { paperById } from "../components/paper";
import { INSTRUMENT_ORDER, INSTRUMENTS, parseEnabledInstruments } from "../insights/assessments";
import { backupFolder, backupNow } from "../backup";
import RestoreBackup from "../components/RestoreBackup";

type FormState = Record<SettingKey, string>;

const INSIGHT_MODULES = [
  { id: "mood", label: "Mood & energy" },
  { id: "rhythm", label: "Week rhythm" },
  { id: "themes", label: "Themes" },
  { id: "people", label: "People" },
  { id: "habits", label: "Habits" },
  { id: "movers", label: "What moves your mood" },
  { id: "emotions", label: "Emotional vocabulary" },
  { id: "wellbeing", label: "Wellbeing checks" },
  { id: "sleep", label: "Sleep" },
  { id: "routine", label: "Daily routine" },
  { id: "activities", label: "Activities & mood" },
  { id: "thinking", label: "Thinking patterns" },
  { id: "reviews", label: "Weekly & monthly reviews" },
  { id: "suggestions", label: "Suggestions" },
] as const;

export default function Settings({ active = true }: { active?: boolean }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [apiKey, setApiKeyState] = useState("");
  const [cloudKey, setCloudKeyState] = useState("");
  const [openAiKey, setOpenAiKeyState] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // The chat reads the saved settings, not this form, so an unsaved switch of
  // provider looks like it worked here and fails there. Tracked to say so.
  const [dirty, setDirty] = useState(false);
  const [exportState, setExportState] = useState<
    { status: "idle" } | { status: "working" } | { status: "done"; names: string[] } | { status: "error"; message: string }
  >({ status: "idle" });
  const [backupState, setBackupState] = useState<
    { status: "idle" } | { status: "working" } | { status: "done" } | { status: "error"; message: string }
  >({ status: "idle" });
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  // Applies at once, without Save. null = the system wouldn't say.
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [folder, setFolder] = useState("Documents/Ember");
  const [testState, setTestState] = useState<
    { status: "idle" } | { status: "testing" } | { status: "ok" } | { status: "error"; message: string }
  >({ status: "idle" });

  // The page stays mounted between visits; it reads the saved settings again
  // on each return, unless there are unsaved changes to keep.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!active || dirtyRef.current) return;
    getAllSettings().then((s) => {
      // Anything unknown (an old default) shows as the free hosted one, which
      // is what the chat falls back to.
      setForm(isKnownProvider(s.provider) ? s : { ...s, provider: "cloud" });
    });
    isEnabled().then(setAutostart).catch(() => setAutostart(null));
    backupFolder().then(setFolder).catch(() => {});
    getApiKey().then(setApiKeyState).catch(() => {});
    getCloudApiKey().then(setCloudKeyState).catch(() => {});
    getOpenAiKey().then(setOpenAiKeyState).catch(() => {});
  }, [active]);

  /** Switching to the free hosted provider with nothing configured yet fills
   *  in the first preset, so the endpoint and model fields are never blank. */
  function selectProvider(value: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, provider: value };
      if (value === "cloud") {
        const preset = CLOUD_PRESETS.find((p) => p.baseUrl === prev.cloud_api_base) ?? CLOUD_PRESETS[0];
        next.cloud_api_base = preset.baseUrl;
        next.model = preset.model;
        next.cloud_max_tokens = String(preset.maxTokens);
      } else if ((value === "anthropic" || value === "claude-subscription") && !prev.model.startsWith("claude")) {
        next.model = "claude-sonnet-5";
      } else if (value === "openai" && !prev.model.startsWith("gpt")) {
        next.model = DEFAULT_OPENAI_MODEL;
      } else if (value === "codex-subscription" && !prev.model.startsWith("gpt")) {
        next.model = "";
      } else if (value === "local" && (prev.model.startsWith("claude") || prev.model.includes("/"))) {
        next.model = "";
      }
      return next;
    });
    setSavedAt(null);
    setDirty(true);
    setTestState({ status: "idle" });
  }

  function update<K extends SettingKey>(key: K, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedAt(null);
    setDirty(true);
  }

  // Only the keys this page edits — writing the whole form back would clobber
  // scheduler-owned keys (reminder_last_fired etc.) with a stale snapshot.
  const EDITABLE_KEYS: SettingKey[] = [
    "user_name",
    "reminder_time",
    "voice",
    "chat_length_preference",
    "conversation_tone",
    "conversation_approach",
    "journal_paper",
    "provider",
    "model",
    "api_base",
    "local_server",
    "ollama_host",
    "local_num_ctx",
    "claude_cli_path",
    "codex_cli_path",
    "usual_lunch",
    "usual_break",
    "usual_dinner",
    "writing_style_sample",
    "context_mode",
    "cloud_api_base",
    "cloud_max_tokens",
    "hidden_modules",
    "assessments_enabled",
    "update_source",
    "update_auto_check",
    "backup_copy",
  ];

  async function handleSave() {
    if (!form) return;
    await Promise.all([
      ...EDITABLE_KEYS.map((key) => setSetting(key, form[key])),
      setApiKey(apiKey), // the app's private key store, never the database
      setCloudApiKey(cloudKey),
      setOpenAiKey(openAiKey),
    ]);
    setSavedAt(Date.now());
    setDirty(false);
    await emit("settings:saved");
  }

  async function handleAutostartToggle() {
    if (autostart === null) return;
    try {
      if (autostart) await disable();
      else await enable();
      setAutostart(await isEnabled());
    } catch {
      setAutostart(null);
    }
  }

  function toggleInstrument(id: Instrument) {
    if (!form) return;
    const on = new Set(parseEnabledInstruments(form.assessments_enabled));
    if (on.has(id)) on.delete(id);
    else on.add(id);
    update("assessments_enabled", INSTRUMENT_ORDER.filter((i) => on.has(i)).join(","));
  }

  function toggleModule(id: string) {
    if (!form) return;
    const hidden = new Set(form.hidden_modules.split(",").map((s) => s.trim()).filter(Boolean));
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    update("hidden_modules", Array.from(hidden).join(","));
  }

  async function handleExport() {
    setExportState({ status: "working" });
    try {
      const names = await exportEverything();
      setExportState(names.length > 0 ? { status: "done", names } : { status: "idle" });
    } catch (e) {
      setExportState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleBackupNow() {
    setBackupState({ status: "working" });
    try {
      await backupNow();
      setBackupState({ status: "done" });
    } catch (e) {
      setBackupState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleDeleteEverything() {
    if (deleteConfirm !== "delete") return;
    await deleteEverything();
    await setApiKey("");
    await setCloudApiKey("");
    await setOpenAiKey("");
    window.location.reload(); // fresh app state — onboarding will greet again
  }

  async function handleTestConnection() {
    // Save before testing: otherwise a passing test proves nothing about the
    // provider the chat will pick up, which is the saved one.
    if (dirty) await handleSave();
    setTestState({ status: "testing" });
    try {
      const provider =
        form?.provider === "anthropic"
          ? createAnthropicProvider({
              apiKey,
              model: form?.model || "claude-sonnet-5",
            })
          : form?.provider === "openai"
            ? createOpenAiProvider({ apiKey: openAiKey, model: form?.model || DEFAULT_OPENAI_MODEL })
          : form?.provider === "cloud"
            ? createCloudProvider({
                baseUrl: form?.cloud_api_base ?? "",
                model: form?.model || "qwen/qwen3.6-27b",
                apiKey: cloudKey,
                maxTokens: Number(form?.cloud_max_tokens) || undefined,
              })
            : await getProvider(); // saved just above
      const reply = await provider.complete(
        [{ role: "user", content: "Reply with only the word: connected" }],
        "You are a connectivity check. Follow the instruction exactly.",
      );
      if (reply.trim().length === 0) throw new ProviderError("Got an empty response back.");
      setTestState({ status: "ok" });
    } catch (e) {
      const message =
        e instanceof ProviderError
          ? [e.message, e.hint].filter(Boolean).join(" ")
          : e instanceof Error
            ? e.message
            : "Connection test failed.";
      setTestState({ status: "error", message });
    }
  }

  if (!form) {
    return <div className="px-5 pt-6 text-[14px] text-ink-faint">Loading settings&hellip;</div>;
  }

  const hiddenSet = new Set(form.hidden_modules.split(",").map((s) => s.trim()).filter(Boolean));
  const style = parseStyle(form.conversation_tone, form.conversation_approach);
  const selectedPreset = CLOUD_PRESETS.find((p) => p.baseUrl === form.cloud_api_base);
  const testButton = (disabled: boolean) => (
    <div className="flex flex-col gap-2">
      <button onClick={handleTestConnection} disabled={testState.status === "testing" || disabled} className="btn-subtle self-start">
        {testState.status === "testing" ? "Testing…" : "Test connection"}
      </button>
      {testState.status === "ok" && <span className="text-[13.5px] text-moss">Connected.</span>}
      {testState.status === "error" && <span className="text-[13.5px] text-danger">{testState.message}</span>}
    </div>
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-5 pb-2 pt-4">
        <h1 className="page-title">Settings</h1>
      </div>

      <Section title="AI provider">
        <Field label="Provider">
          <select className="input" value={form.provider} onChange={(e) => selectProvider(e.target.value)}>
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="hint">{PROVIDER_OPTIONS.find((p) => p.id === form.provider)?.blurb}</span>
        </Field>

        {form.provider === "local" && (
          <>
            <LocalModelSetup form={form} update={update} saveFirst={async () => (dirty ? handleSave() : undefined)} />
            {testButton(!form.model.trim())}
          </>
        )}

        {form.provider === "claude-subscription" && (
          <>
            <ClaudeSubscriptionSetup cliPath={form.claude_cli_path} onCliPath={(v) => update("claude_cli_path", v)} />
            <Field label="Model">
              <input
                className="input"
                autoCapitalize="off"
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="claude-sonnet-5"
              />
            </Field>
            {testButton(false)}
          </>
        )}

        {form.provider === "cloud" && (
          <>
            <Field label="Service">
              <select
                className="input"
                value={selectedPreset?.id ?? "custom"}
                onChange={(e) => {
                  const preset = CLOUD_PRESETS.find((p) => p.id === e.target.value);
                  if (!preset) return;
                  update("cloud_api_base", preset.baseUrl);
                  update("model", preset.model);
                  update("cloud_max_tokens", String(preset.maxTokens));
                }}
              >
                {CLOUD_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {!selectedPreset && <option value="custom">Custom endpoint</option>}
              </select>
              {selectedPreset && (
                <span className="hint">
                  {selectedPreset.note}
                </span>
              )}
            </Field>

            <Field label="API key">
              <input
                type="password"
                autoComplete="off"
                className="input"
                value={cloudKey}
                onChange={(e) => {
                  setCloudKeyState(e.target.value);
                  setDirty(true);
                }}
                placeholder="Paste your key"
              />
              {selectedPreset && (
                <span className="hint">
                  Get one at <KeyLink url={selectedPreset.keysUrl} />.
                </span>
              )}
            </Field>

            <Field label="Model">
              <input
                className="input"
                autoCapitalize="off"
                autoCorrect="off"
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder={selectedPreset?.model || "qwen/qwen3.6-27b"}
              />
            </Field>

            <details className="group">
              <summary className="cursor-pointer list-none text-[14px] text-ink-soft">
                <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
                Advanced
              </summary>
              <div className="mt-4 flex flex-col gap-5">
                <Field label="Endpoint address">
                  <input
                    className="input"
                    autoCapitalize="off"
                    autoCorrect="off"
                    value={form.cloud_api_base}
                    onChange={(e) => update("cloud_api_base", e.target.value)}
                    placeholder="https://api.groq.com/openai/v1/chat/completions"
                  />
                  <span className="hint">Only the services listed above are allowed.</span>
                </Field>
                <Field label="Max reply length (tokens)">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={form.cloud_max_tokens}
                    onChange={(e) => update("cloud_max_tokens", e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder={String(selectedPreset?.maxTokens ?? 900)}
                  />
                  <span className="hint">Free tiers reject replies over their limit. Raise with care.</span>
                </Field>
              </div>
            </details>

            {testButton(!cloudKey || !form.cloud_api_base)}
          </>
        )}

        {form.provider === "codex-subscription" && (
          <>
            <CodexSetup cliPath={form.codex_cli_path} onCliPath={(v) => update("codex_cli_path", v)} />
            <Field label="Model">
              <input
                className="input"
                autoCapitalize="off"
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="Codex's default"
              />
            </Field>
            {testButton(false)}
          </>
        )}

        {form.provider === "openai" && (
          <>
            <Field label="API key">
              <input
                type="password"
                autoComplete="off"
                className="input"
                value={openAiKey}
                onChange={(e) => {
                  setOpenAiKeyState(e.target.value);
                  setDirty(true);
                }}
                placeholder="sk-..."
              />
              <span className="hint">
                Get one at <KeyLink url={OPENAI_KEYS_URL} />.
              </span>
            </Field>
            <Field label="Model">
              <input
                className="input"
                autoCapitalize="off"
                autoCorrect="off"
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder={DEFAULT_OPENAI_MODEL}
              />
            </Field>
            {testButton(!openAiKey)}
          </>
        )}

        {form.provider === "anthropic" && (
          <>
            <Field label="API key">
              <input
                type="password"
                autoComplete="off"
                className="input"
                value={apiKey}
                onChange={(e) => {
                  setApiKeyState(e.target.value);
                  setDirty(true);
                }}
                placeholder="sk-ant-..."
              />
              <span className="hint">
                Get one at <KeyLink url={ANTHROPIC_KEYS_URL} />.
              </span>
            </Field>
            <Field label="Model">
              <input
                className="input"
                autoCapitalize="off"
                autoCorrect="off"
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="claude-sonnet-5"
              />
            </Field>
            {testButton(!apiKey)}
          </>
        )}
      </Section>

      <Section title="How much Ember sends the model">
        <Field label="Context">
          <select className="input" value={form.context_mode || "auto"} onChange={(e) => update("context_mode", e.target.value)}>
            <option value="auto">Automatic: compact for local and free models</option>
            <option value="full">Everything: best with Claude or GPT</option>
            <option value="compact">Compact: a short prompt and only what matters today</option>
          </select>
          <span className="hint">
            Compact fits small models: a briefing is written before each conversation, older parts of a long chat are
            summarised, and Insights work in smaller steps.
          </span>
        </Field>
      </Section>

      <Section title="Sync with phone">
        <PhoneLinkSettings />
      </Section>

      <Section title="You">
        <Field label="Your name">
          <input className="input" value={form.user_name} onChange={(e) => update("user_name", e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="Daily reminder">
          <input type="time" className="input w-40" value={form.reminder_time} onChange={(e) => update("reminder_time", e.target.value)} />
          <span className="hint">Skipped once today&rsquo;s entry is written.</span>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="label">Your usual times</span>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ["usual_lunch", "Lunch"],
                ["usual_break", "Break"],
                ["usual_dinner", "Dinner"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1 text-[12px] text-ink-faint">
                {label}
                <input type="time" className="input w-full" value={form[key]} onChange={(e) => update(key, e.target.value)} />
              </label>
            ))}
          </div>
          <span className="hint">Offered in the check-in, where the day is split at these times.</span>
        </div>
        <Field label="Journal voice">
          <select className="input" value={form.voice} onChange={(e) => update("voice", e.target.value)}>
            <option value="first">First person (&ldquo;I&hellip;&rdquo;)</option>
            <option value="second">Second person (&ldquo;You&hellip;&rdquo;)</option>
          </select>
        </Field>
        <label className="flex items-center justify-between gap-4">
          <span className="label">
            Open Ember at login
            <span className="hint mt-0.5 block">Keeps {captureHotkeyLabel()} and reminders working.</span>
          </span>
          <input
            type="checkbox"
            checked={autostart === true}
            disabled={autostart === null}
            onChange={handleAutostartToggle}
            className="h-5 w-5 shrink-0 accent-ember"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="label">Default paper</span>
          <PaperPicker value={paperById(form.journal_paper).id} onChange={(id) => update("journal_paper", id)} />
        </div>
      </Section>

      <Section title="Conversation">
        <Field label="Length">
          <select
            className="input"
            value={["quick", "long"].includes(form.chat_length_preference) ? form.chat_length_preference : "standard"}
            onChange={(e) => update("chat_length_preference", e.target.value)}
          >
            <option value="quick">Brief (3–4 exchanges)</option>
            <option value="standard">Standard (8–10 exchanges)</option>
            <option value="long">Long (15–20 exchanges)</option>
          </select>
        </Field>
        <StylePicker
          tone={style.tone}
          approach={style.approach}
          onTone={(v) => update("conversation_tone", v)}
          onApproach={(v) => update("conversation_approach", v)}
        />
      </Section>

      <Section title="Documents">
        <p className="hint">Ticked .md or .txt files are read in every conversation. Add a file again after editing it.</p>
        <DocumentsManager />
      </Section>

      <Section title="Wellbeing questionnaires">
        <p className="hint">Offered every two weeks at the check-in. A score is not a diagnosis.</p>
        <div className="flex flex-col gap-3">
          {INSTRUMENT_ORDER.map((id) => (
            <label key={id} className="flex items-start gap-3 text-[15px] text-ink">
              <input
                type="checkbox"
                checked={parseEnabledInstruments(form.assessments_enabled).includes(id)}
                onChange={() => toggleInstrument(id)}
                className="mt-1 h-5 w-5 shrink-0 accent-ember"
              />
              <span>
                {INSTRUMENTS[id].name}
                <span className="block text-[13px] text-ink-faint">{INSTRUMENTS[id].what}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Insights">
        <p className="hint">Sections shown on the Insights page.</p>
        <div className="grid grid-cols-1 gap-y-3 min-[380px]:grid-cols-2 min-[380px]:gap-x-3">
          {INSIGHT_MODULES.map((m) => (
            <label key={m.id} className="flex items-center gap-3 text-[14.5px] text-ink">
              <input type="checkbox" checked={!hiddenSet.has(m.id)} onChange={() => toggleModule(m.id)} className="h-5 w-5 shrink-0 accent-ember" />
              {m.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Your writing style">
        <WritingStyle value={form.writing_style_sample} onChange={(v) => update("writing_style_sample", v)} />
      </Section>

      <Section title="Updates & feedback">
        <UpdatesAndFeedback
          source={form.update_source}
          autoCheck={form.update_auto_check === "1"}
          onAutoCheckChange={(v) => update("update_auto_check", v ? "1" : "")}
          onSave={handleSave}
        />
      </Section>

      <Section title="Data">
        <div className="flex flex-col gap-2.5">
          <label className="flex items-start gap-3 text-[14.5px] text-ink">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-ember"
              checked={form.backup_copy === "1"}
              onChange={(e) => update("backup_copy", e.target.checked ? "1" : "")}
            />
            <span>
              Daily backup to {folder}
              {form.backup_last_at && (
                <span className="hint block">Last backup: {new Date(form.backup_last_at).toLocaleString()}</span>
              )}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <button onClick={handleBackupNow} disabled={backupState.status === "working"} className="btn-subtle">
              {backupState.status === "working" ? "Backing up…" : "Back up now"}
            </button>
          </div>
          <RestoreBackup
            label="Restore backup"
            buttonClass="btn-subtle self-start"
            warning="This replaces all current data. Ember restarts."
          />
          {backupState.status === "done" && <p className="text-[13.5px] text-moss">Saved to {folder}.</p>}
          {backupState.status === "error" && <p className="text-[13.5px] text-danger">{backupState.message}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button onClick={handleExport} disabled={exportState.status === "working"} className="btn-subtle">
            {exportState.status === "working" ? "Exporting…" : "Export"}
          </button>
          {!showDelete && (
            <button onClick={() => setShowDelete(true)} className="btn-danger">
              Reset Ember
            </button>
          )}
        </div>
        {exportState.status === "done" && (
          <p className="text-[13.5px] text-moss">
            Saved:{" "}
            {exportState.names.map((n) => (
              <span key={n} className="block break-all text-ink-faint">
                {n}
              </span>
            ))}
          </p>
        )}
        {exportState.status === "error" && <p className="text-[13.5px] text-danger">{exportState.message}</p>}
        {showDelete && (
          <div className="fade-up flex flex-col gap-3 rounded-xl bg-danger-wash px-4 py-3.5">
            <p className="text-[13.5px] leading-relaxed text-danger">
              Erases all entries, notes, conversations, settings and API keys. A paired phone is reset at its next sync;
              notes it hasn&rsquo;t synced yet are kept. This can&rsquo;t be undone. Type <b>delete</b> to confirm.
            </p>
            <input
              className="input"
              autoCapitalize="off"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="delete"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleDeleteEverything}
                disabled={deleteConfirm !== "delete"}
                className="min-h-[42px] rounded-lg bg-danger px-4 py-2 text-[14px] font-medium text-paper transition-opacity disabled:opacity-40"
              >
                Erase
              </button>
              <button
                onClick={() => {
                  setShowDelete(false);
                  setDeleteConfirm("");
                }}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Stays in reach at the bottom of the screen however far down you are. */}
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule bg-paper/95 px-5 py-3">
        <button onClick={handleSave} className="btn-primary">
          Save
        </button>
        {savedAt && !dirty && <span className="fade-up text-[13px] text-ink-faint">Saved</span>}
        {dirty && <span className="flex-1 text-[12.5px] leading-snug text-ember">Unsaved changes</span>}
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-rule px-5 py-6 first-of-type:border-t-0">
      <div>
        <h2 className="section-title">{title}</h2>
        {note && <p className="hint mt-0.5">{note}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
