import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { localModelStatus, prepareLocalModel, type ModelStatus } from "../../localModel";
import type { SettingKey } from "../../db/types";
import Wingbeat from "../Wingbeat";

const STATE_TEXT: Record<ModelStatus["state"], string> = {
  off: "Not loaded",
  starting: "Starting Ollama…",
  loading: "Loading…",
  ready: "Loaded",
  "not-installed": "Ollama not installed",
  "not-running": "Ollama not responding",
  "no-model": "Model not downloaded",
  error: "Couldn't load",
};

/** A model on this computer: Ollama (kept loaded by Elytra) or an
 *  OpenAI-compatible local server such as LM Studio. */
export default function LocalModelSetup({
  form,
  update,
  saveFirst,
}: {
  form: Record<SettingKey, string>;
  update: (key: SettingKey, value: string) => void;
  /** Saves the form, so loading uses what's on screen. */
  saveFirst: () => Promise<void>;
}) {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [working, setWorking] = useState(false);
  const ollama = form.local_server !== "openai";

  useEffect(() => {
    localModelStatus().then(setStatus).catch(() => {});
    const unlisten = listen<ModelStatus>("local-model:changed", (e) => setStatus(e.payload));
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  async function loadNow() {
    setWorking(true);
    try {
      await saveFirst();
      setStatus(await prepareLocalModel());
    } finally {
      setWorking(false);
    }
  }

  const models = status?.models ?? [];
  const busy = working || status?.state === "starting" || status?.state === "loading";
  const ready = status?.state === "ready";

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="label">Server</span>
        <select className="input" value={ollama ? "ollama" : "openai"} onChange={(e) => update("local_server", e.target.value)}>
          <option value="ollama">Ollama</option>
          <option value="openai">LM Studio or other OpenAI-compatible server</option>
        </select>
      </label>

      {ollama ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="label">Model</span>
            {models.length > 0 ? (
              <select className="input" value={form.model} onChange={(e) => update("model", e.target.value)}>
                {!models.includes(form.model) && <option value={form.model}>{form.model || "Choose a model"}</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                autoCapitalize="off"
                autoCorrect="off"
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="qwen3.5:4b"
              />
            )}
          </label>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Wingbeat live={busy} className={ready || busy ? "" : "opacity-40 grayscale"} />
            <span className="min-w-0 flex-1 text-[14px] text-fg">
              {status ? STATE_TEXT[status.state] : "Checking…"}
              {status?.message && !ready && !busy && <span className="block text-[13px] text-fg-faint">{status.message}</span>}
            </span>
            <button onClick={loadNow} disabled={busy || !form.model.trim()} className="btn-subtle min-h-[36px] py-1.5">
              {busy ? "Loading…" : ready ? "Reload" : "Load"}
            </button>
          </div>
          {status?.state === "not-installed" && (
            <p className="hint">
              Install from{" "}
              <button className="text-moss underline" onClick={() => openUrl("https://ollama.com/download")}>
                ollama.com/download
              </button>
              , then run <code className="rounded bg-surface-high px-1">ollama pull qwen3.5:4b</code>.
            </p>
          )}

          <details className="group">
            <summary className="cursor-pointer list-none text-[14px] text-fg-dim">
              <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
              Advanced
            </summary>
            <div className="mt-4 flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="label">Context size (tokens)</span>
                <input
                  className="input w-40"
                  inputMode="numeric"
                  value={form.local_num_ctx}
                  onChange={(e) => update("local_num_ctx", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="8192"
                />
                <span className="hint">Higher uses more memory.</span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label">Ollama address</span>
                <input
                  className="input"
                  autoCapitalize="off"
                  value={form.ollama_host}
                  onChange={(e) => update("ollama_host", e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </label>
            </div>
          </details>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="label">Server address</span>
            <input
              className="input"
              autoCapitalize="off"
              value={form.api_base}
              onChange={(e) => update("api_base", e.target.value)}
              placeholder="http://localhost:1234/v1/chat/completions"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Model</span>
            <input className="input" autoCapitalize="off" value={form.model} onChange={(e) => update("model", e.target.value)} />
          </label>
          <p className="hint">Start the server before chatting. Phone chat works only with Ollama.</p>
        </>
      )}
    </div>
  );
}
