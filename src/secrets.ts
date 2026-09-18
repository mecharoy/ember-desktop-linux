// API keys for the AI providers, kept in the app's private storage (lib.rs).
// The Rust side whitelists the secret names, so this file is the only channel
// and it can only touch these two credentials and the install id.

import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "./db/settings";
import type { SettingKey } from "./db/types";

const API_KEY_NAME = "anthropic_api_key";
const CLOUD_KEY_NAME = "cloud_api_key";
const OPENAI_KEY_NAME = "openai_api_key";

/** Reads one credential, falling back to a settings-table copy on systems
 *  with no OS credential store (e.g. bare Linux without a secret service). */
async function readSecret(name: string, fallbackKey: SettingKey): Promise<{ value: string; keychainOk: boolean }> {
  try {
    const fromKeychain = await invoke<string | null>("secret_get", { name });
    if (fromKeychain) return { value: fromKeychain, keychainOk: true };
    return { value: await getSetting(fallbackKey), keychainOk: true };
  } catch {
    return { value: await getSetting(fallbackKey), keychainOk: false };
  }
}

async function writeSecret(name: string, fallbackKey: SettingKey, value: string): Promise<void> {
  try {
    await invoke("secret_set", { name, value });
    await setSetting(fallbackKey, ""); // belt-and-braces: never leave a db copy
  } catch {
    // No OS credential store — fall back to the settings table so the key can
    // still be saved at all; the matching read already looks there.
    await setSetting(fallbackKey, value);
  }
}

export async function getApiKey(): Promise<string> {
  const { value, keychainOk } = await readSecret(API_KEY_NAME, "api_key");

  // Pre-Phase-6 installs kept the key in the settings table — migrate it to
  // the keychain on first read and scrub the database copy.
  if (value && keychainOk) {
    const legacy = await getSetting("api_key");
    if (legacy) {
      await invoke("secret_set", { name: API_KEY_NAME, value: legacy });
      await setSetting("api_key", "");
    }
  }
  return value;
}

/** Empty string deletes the credential. */
export async function setApiKey(value: string): Promise<void> {
  await writeSecret(API_KEY_NAME, "api_key", value);
}

/** Key for the free hosted provider (Groq, Gemini, OpenRouter…). Kept apart
 *  from the Anthropic key so switching provider doesn't overwrite either. */
export async function getCloudApiKey(): Promise<string> {
  const { value } = await readSecret(CLOUD_KEY_NAME, "cloud_api_key");
  return value;
}

/** Empty string deletes the credential. */
export async function setCloudApiKey(value: string): Promise<void> {
  await writeSecret(CLOUD_KEY_NAME, "cloud_api_key", value);
}

/** Key for the OpenAI API (ChatGPT's models, pay as you go). */
export async function getOpenAiKey(): Promise<string> {
  const { value } = await readSecret(OPENAI_KEY_NAME, "openai_api_key");
  return value;
}

/** Empty string deletes the credential. */
export async function setOpenAiKey(value: string): Promise<void> {
  await writeSecret(OPENAI_KEY_NAME, "openai_api_key", value);
}

/** This install's id, kept beside the keys so backups never carry it.
 *  Throws if the private store can't be read. */
export async function getLocalInstallId(): Promise<string> {
  return (await invoke<string | null>("secret_get", { name: "install_id" })) ?? "";
}

export async function setLocalInstallId(value: string): Promise<void> {
  await invoke("secret_set", { name: "install_id", value });
}
