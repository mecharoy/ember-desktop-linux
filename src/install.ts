// Telling a restored journal apart from this install's own.
//
// Each install keeps a random id twice: in the journal (settings.install_id),
// which travels with backups, and in the private store beside the API keys,
// which never does. When they differ, the journal came from another install
// by a restored backup file, and its API key didn't come along, so Ember asks
// for it on a "Welcome back" screen.

import { getSetting, setSetting } from "./db/settings";
import { getApiKey, getCloudApiKey, getLocalInstallId, setLocalInstallId } from "./secrets";

export type FirstRunScreen = "setup" | "welcome-back" | "none";

export function decideFirstRun(state: {
  onboarded: boolean;
  journalId: string;
  localId: string;
  hasKey: boolean;
}): FirstRunScreen {
  if (!state.onboarded) return "setup";
  // Both empty: an install from before ids existed, nothing was restored.
  if (state.journalId !== state.localId && !state.hasKey) return "welcome-back";
  return "none";
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Makes the journal and this install share one id from now on. */
export async function claimJournal(): Promise<void> {
  const [journalId, localId] = await Promise.all([getSetting("install_id"), getLocalInstallId()]);
  const id = journalId || localId || newId();
  if (journalId !== id) await setSetting("install_id", id);
  if (localId !== id) await setLocalInstallId(id);
}

/** Which first-run screen to show when Ember opens. */
export async function firstRunScreen(): Promise<FirstRunScreen> {
  const [onboarded, journalId, provider] = await Promise.all([
    getSetting("onboarded"),
    getSetting("install_id"),
    getSetting("provider"),
  ]);
  let localId: string;
  try {
    localId = await getLocalInstallId();
  } catch {
    // Can't tell installs apart without the private store; don't nag.
    return onboarded === "1" ? "none" : "setup";
  }
  // The local model and the Claude subscription need no key.
  const key =
    provider === "local" || provider === "claude-subscription"
      ? "none needed"
      : provider === "anthropic"
        ? await getApiKey()
        : await getCloudApiKey();
  const screen = decideFirstRun({ onboarded: onboarded === "1", journalId, localId, hasKey: Boolean(key) });
  if (screen !== "welcome-back") await claimJournal().catch(() => {});
  return screen;
}
