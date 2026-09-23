import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getAllSettings } from "./db/settings";
import { numCtxSetting } from "./ai/factory";
import { DEFAULT_OLLAMA_HOST } from "./ai/providers/ollama";

// While Elytra is open with the local model chosen, Ollama is running and the
// model is loaded: checked at launch, after Settings are saved, and every few
// minutes (which also keeps Ollama from unloading it). The Rust side
// (local_model.rs) does the work and lets the model go when Elytra quits.

export interface ModelStatus {
  state: "off" | "starting" | "loading" | "ready" | "not-installed" | "not-running" | "no-model" | "error";
  message: string;
  model: string;
  models: string[];
}

const REFRESH_MS = 10 * 60 * 1000;
let preparing: Promise<ModelStatus> | null = null;

async function prepare(): Promise<ModelStatus> {
  const s = await getAllSettings();
  if (s.provider !== "local" || s.local_server === "openai") {
    await invoke("local_model_release").catch(() => {});
    const off: ModelStatus = { state: "off", message: "", model: "", models: [] };
    await emit("local-model:changed", off);
    return off;
  }
  await emit("local-model:changed", { state: "loading", message: "Getting the model ready…", model: s.model, models: [] });
  const status = await invoke<ModelStatus>("local_model_prepare", {
    host: s.ollama_host || DEFAULT_OLLAMA_HOST,
    model: s.model,
    numCtx: numCtxSetting(s.local_num_ctx),
  });
  await emit("local-model:changed", status);
  return status;
}

/** Brings Ollama and the chosen model up (or lets them go). One at a time. */
export function prepareLocalModel(): Promise<ModelStatus> {
  if (!preparing) {
    preparing = prepare().finally(() => {
      preparing = null;
    });
  }
  return preparing;
}

export function localModelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("local_model_status");
}

/** The models Ollama has downloaded, without loading anything. */
export async function listOllamaModels(): Promise<string[]> {
  return (await localModelStatus()).models;
}

let started = false;

export function startLocalModelKeeper(): void {
  if (started) return;
  started = true;
  prepareLocalModel().catch(() => {});
  setInterval(() => void prepareLocalModel().catch(() => {}), REFRESH_MS);
  listen("settings:saved", () => void prepareLocalModel().catch(() => {})).catch(() => {});
}
