import { useState } from "react";
import { checkClaudeCli, installClaudeCli, openClaudeLogin, waitForClaudeCli } from "../../ai/providers/claudeSubscription";

type Status<T extends object = object> =
  | { status: "idle" }
  | { status: "busy" }
  | ({ status: "ok" } & T)
  | { status: "error"; message: string };

/** Checking for, installing and signing in to Claude Code. */
export default function ClaudeSubscriptionSetup({
  cliPath,
  onCliPath,
}: {
  cliPath: string;
  onCliPath: (value: string) => void;
}) {
  const [cli, setCli] = useState<Status<{ version: string; path: string }>>({ status: "idle" });
  const [login, setLogin] = useState<Status<{ message: string }>>({ status: "idle" });
  const [install, setInstall] = useState<Status<{ message: string }> | { status: "waiting" }>({ status: "idle" });

  async function check() {
    setCli({ status: "busy" });
    const result = await checkClaudeCli();
    setCli(result.ok ? { status: "ok", version: result.version, path: result.path } : { status: "error", message: result.message });
  }

  async function signIn() {
    setLogin({ status: "busy" });
    const result = await openClaudeLogin();
    setLogin(result.ok ? { status: "ok", message: result.message } : { status: "error", message: result.message });
  }

  /** Opens the installer, waits for the CLI to appear, then moves on to sign-in. */
  async function runInstall() {
    setInstall({ status: "busy" });
    const result = await installClaudeCli();
    if (!result.ok) {
      setInstall({ status: "error", message: result.message });
      return;
    }
    setInstall({ status: "waiting" });
    if (!(await waitForClaudeCli())) {
      setInstall({ status: "error", message: "Claude Code wasn't found after 5 minutes. Check again once the installer finishes." });
      return;
    }
    setInstall({ status: "ok", message: "Installed." });
    await check();
    await signIn();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="hint">Uses Claude Code. Install and sign-in open a terminal window.</p>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={check} disabled={cli.status === "busy"} className="btn-subtle">
          {cli.status === "busy" ? "Checking…" : "Check for Claude Code"}
        </button>
        {cli.status === "ok" && <span className="text-[13px] text-moss">Found {cli.version}</span>}
        {cli.status === "error" && <span className="text-[13px] text-danger">{cli.message}</span>}
      </div>

      {cli.status === "error" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runInstall}
            disabled={install.status === "busy" || install.status === "waiting"}
            className="btn-subtle"
          >
            {install.status === "busy" || install.status === "waiting" ? "Installing…" : "Install Claude Code"}
          </button>
          {install.status === "ok" && <span className="text-[13px] text-moss">{install.message}</span>}
          {install.status === "error" && <span className="text-[13px] text-danger">{install.message}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={signIn} disabled={login.status === "busy"} className="btn-subtle">
          {login.status === "busy" ? "Opening…" : "Sign in"}
        </button>
        {login.status === "ok" && <span className="text-[13px] text-moss">{login.message}</span>}
        {login.status === "error" && <span className="text-[13px] text-danger">{login.message}</span>}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="label">Claude Code path</span>
        <input className="input" value={cliPath} onChange={(e) => onCliPath(e.target.value)} placeholder="Detected automatically" />
      </label>
    </div>
  );
}
