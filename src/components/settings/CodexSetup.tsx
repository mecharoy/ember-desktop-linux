import { useState } from "react";
import { checkCodexCli, installCodexCli, openCodexLogin } from "../../ai/providers/codexSubscription";

type Status = { status: "idle" | "busy" } | { status: "ok"; message: string } | { status: "error"; message: string };

/** Checking for, installing and signing in to OpenAI's Codex CLI. */
export default function CodexSetup({ cliPath, onCliPath }: { cliPath: string; onCliPath: (value: string) => void }) {
  const [cli, setCli] = useState<Status>({ status: "idle" });
  const [action, setAction] = useState<Status>({ status: "idle" });

  async function check() {
    setCli({ status: "busy" });
    const r = await checkCodexCli();
    setCli(r.ok ? { status: "ok", message: `Found ${r.version}` } : { status: "error", message: r.message });
  }

  async function run(fn: typeof openCodexLogin) {
    setAction({ status: "busy" });
    const r = await fn();
    setAction(r.ok ? { status: "ok", message: r.message } : { status: "error", message: r.message });
  }

  const line = (s: Status) =>
    s.status === "ok" ? (
      <span className="text-[13px] text-moss">{s.message}</span>
    ) : s.status === "error" ? (
      <span className="text-[13px] text-danger">{s.message}</span>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="hint">Uses Codex with your ChatGPT plan. Install and sign-in open a terminal window. Replies arrive whole, not word by word.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={check} disabled={cli.status === "busy"} className="btn-subtle">
          {cli.status === "busy" ? "Checking…" : "Check for Codex"}
        </button>
        {line(cli)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {cli.status === "error" && (
          <button onClick={() => run(installCodexCli)} disabled={action.status === "busy"} className="btn-subtle">
            Install Codex
          </button>
        )}
        <button onClick={() => run(openCodexLogin)} disabled={action.status === "busy"} className="btn-subtle">
          Sign in
        </button>
        {line(action)}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">Codex path</span>
        <input className="input" value={cliPath} onChange={(e) => onCliPath(e.target.value)} placeholder="Detected automatically" />
      </label>
    </div>
  );
}
