import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate, DEFAULT_UPDATE_SOURCE, manifestUrlFor, parseRepo, type CheckResult } from "../update/update";
import {
  FEEDBACK_KINDS,
  feedbackBody,
  feedbackIssueUrl,
  feedbackTitle,
  MAX_FEEDBACK_CHARS,
  systemName,
  type FeedbackKind,
} from "../update/feedback";

/**
 * Settings → Updates & feedback. The source is the GitHub
 * repository releases come from; it can be pasted here, which wins over the
 * built-in one. Feedback opens a pre-filled GitHub issue for the user to
 * review and submit — or can be copied to send any other way.
 *
 * `source` / `autoCheck` are the page's form values, saved with the rest of
 * Settings; checking uses the saved values, so it saves first (onSave).
 */
export default function UpdatesAndFeedback({
  source,
  autoCheck,
  onAutoCheckChange,
  onSave,
}: {
  source: string;
  autoCheck: boolean;
  onAutoCheckChange: (v: boolean) => void;
  onSave: () => Promise<void>;
}) {
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<{ busy: boolean; result: CheckResult | null }>({ busy: false, result: null });
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [text, setText] = useState("");
  const [includeAbout, setIncludeAbout] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const effective = source.trim() || DEFAULT_UPDATE_SOURCE;
  const sourceValid = source.trim() === "" || manifestUrlFor(source) !== null;
  const about = includeAbout ? `Elytra ${version || "?"} · ${systemName(navigator.userAgent)}` : null;
  const input = { kind, text, about };
  const issueUrl = feedbackIssueUrl(effective, input);

  async function handleCheck() {
    setCheck({ busy: true, result: null });
    await onSave();
    setCheck({ busy: false, result: await checkForUpdate(true) });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`${feedbackTitle(input)}\n\n${feedbackBody(input)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const r = check.result;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-fg">This is Elytra {version || "…"}.</p>
        <label className="flex items-center gap-3 text-[14.5px] text-fg">
          <input type="checkbox" checked={autoCheck} onChange={(e) => onAutoCheckChange(e.target.checked)} className="h-5 w-5 accent-moss" />
          Look for a new version when Elytra opens
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleCheck} disabled={check.busy || !sourceValid} className="btn-subtle">
            {check.busy ? "Checking…" : "Check for updates"}
          </button>
          {r?.status === "current" && <span className="text-[13.5px] text-moss">You have the latest version.</span>}
          {r?.status === "unconfigured" && <span className="text-[13.5px] text-fg-faint">No update source set.</span>}
          {r?.status === "unreachable" && <span className="text-[13.5px] text-fg-faint">Couldn&rsquo;t reach GitHub.</span>}
          {r?.status === "available" && (
            <span className="flex items-center gap-2 text-[13.5px] text-fg">
              Elytra {r.release.version} is out.
              <button onClick={() => openUrl(r.release.downloadUrl).catch(() => {})} className="btn-primary">
                Download
              </button>
            </span>
          )}
        </div>
        <p className="hint">Run the downloaded installer to update.</p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label">Send feedback</span>
        <div className="flex gap-0.5" role="group" aria-label="Kind of feedback">
          {FEEDBACK_KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className="seg">
              {k.label}
            </button>
          ))}
        </div>
        <textarea
          className="input min-h-[110px] resize-y"
          value={text}
          maxLength={MAX_FEEDBACK_CHARS}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "bug" ? "What happened, and what did you expect instead?" : "What would make Elytra better for you?"}
        />
        <label className="flex items-center gap-2.5 text-[13px] text-fg-dim">
          <input type="checkbox" checked={includeAbout} onChange={(e) => setIncludeAbout(e.target.checked)} className="h-3.5 w-3.5 accent-moss" />
          Include the version and system ({`Elytra ${version || "?"} · ${systemName(navigator.userAgent)}`})
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => issueUrl && openUrl(issueUrl).catch(() => {})}
            disabled={!issueUrl}
            className="btn-primary"
            title={parseRepo(effective) ? undefined : "Set where updates come from first"}
          >
            Open on GitHub
          </button>
          <button onClick={handleCopy} disabled={!text.trim()} className="btn-ghost">
            {copied ? "Copied" : "Copy text"}
          </button>
        </div>
        <p className="hint">
          Opens a ready-to-send issue on GitHub for you to check and submit. Nothing from your journal is added.
        </p>
      </div>
    </div>
  );
}
