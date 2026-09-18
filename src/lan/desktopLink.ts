import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getSetting, setSetting } from "../db/settings";
import { answerSyncRequest, forgetPeer, listSyncPeers, type SyncRequest as SyncPayload } from "../db/sync";
import { claimJournal } from "../install";
import { getLocalInstallId, setApiKey, setCloudApiKey } from "../secrets";
import { announceSync, settleRestoredJournal, sinceLabel } from "./syncEvents";
import { makeRoomForConversation, noteConversation } from "../ai/modelActivity";
import { getProvider } from "../ai/factory";
import { ProviderError, type ChatMessage } from "../ai/types";

// The computer's side of the phone link. Rust (lan_server.rs) runs the
// server, the pairing and the sealing; sync requests come here, because the
// journal is only read and written from src/db.

export interface PhoneInfo {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
}

export interface LanInfo {
  enabled: boolean;
  port: number | null;
  addresses: string[];
  name: string;
  peers: PhoneInfo[];
  pairingCode: string | null;
  pairingSecondsLeft: number | null;
  error: string | null;
}

interface SyncRequest {
  requestId: string;
  peerId: string;
  peerName: string;
  kind: string;
  payload: Partial<SyncPayload>;
}

async function deviceId(): Promise<string> {
  let id = await getLocalInstallId();
  if (!id) {
    await claimJournal();
    id = await getLocalInstallId();
  }
  return id;
}

export function lanInfo(): Promise<LanInfo> {
  return invoke<LanInfo>("lan_info");
}

/** Switches the link on or off, and remembers the choice. */
export async function setPhoneLink(enabled: boolean): Promise<LanInfo> {
  await setSetting("lan_enabled", enabled ? "1" : "");
  const info = enabled
    ? await invoke<LanInfo>("lan_enable", { deviceId: await deviceId() })
    : await invoke<LanInfo>("lan_disable");
  await emit("lan:peers-changed");
  return info;
}

export function startPairing(): Promise<LanInfo> {
  return invoke<LanInfo>("lan_pairing_start");
}

export function stopPairing(): Promise<LanInfo> {
  return invoke<LanInfo>("lan_pairing_stop");
}

/** Unpairs a phone. Its journal stays on both devices. */
export async function removePhone(id: string): Promise<LanInfo> {
  const info = await invoke<LanInfo>("lan_peer_remove", { id });
  await forgetPeer(id);
  await emit("lan:peers-changed");
  return info;
}

async function handleSync(req: SyncRequest): Promise<void> {
  try {
    await settleRestoredJournal();
    const { reply, applied, reset } = await answerSyncRequest(req.peerId, req.peerName, req.payload);
    await invoke("lan_reply", { requestId: req.requestId, payload: reply });
    if (reset) {
      // The phone was reset: so is this computer, keys included. Start fresh.
      await setApiKey("").catch(() => {});
      await setCloudApiKey("").catch(() => {});
      window.location.reload();
      return;
    }
    await announceSync(applied);
  } catch (e) {
    await invoke("lan_reply", { requestId: req.requestId, error: e instanceof Error ? e.message : String(e) }).catch(() => {});
  }
}

interface ChatRequest {
  requestId: string;
  /** The phone's Ollama /api/chat body: messages with the system prompt first. */
  body: { messages?: { role?: string; content?: string }[] };
}

/** Phone chats in progress here, so a phone hanging up stops the provider. */
const phoneChats = new Map<string, () => void>();

/**
 * A phone chat when this computer isn't on a local model: Ember's own AI
 * provider answers, and the reply goes back as Ollama-shaped lines, which is
 * what the phone reads (lan_server.rs).
 */
async function answerPhoneChat(req: ChatRequest): Promise<void> {
  const push = (kind: "line" | "done" | "error", text?: string) =>
    invoke("lan_chat_push", { requestId: req.requestId, kind, text: text ?? null });
  let stopped = false;
  phoneChats.set(req.requestId, () => {
    stopped = true;
  });
  try {
    const all = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const system = all
      .filter((m) => m.role === "system")
      .map((m) => m.content ?? "")
      .join("\n\n");
    const messages: ChatMessage[] = all
      .filter((m): m is { role: "user" | "assistant"; content: string } => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content }));
    if (messages.length === 0) throw new ProviderError("The phone sent an empty conversation.");
    await makeRoomForConversation();
    const provider = await getProvider();
    for await (const text of provider.chatStream(messages, system)) {
      if (stopped) return;
      await push("line", JSON.stringify({ message: { role: "assistant", content: text }, done: false }));
    }
    if (stopped) return;
    await push("line", JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }));
    await push("done");
  } catch (e) {
    if (stopped) return;
    const message =
      e instanceof ProviderError ? [e.message, e.hint].filter(Boolean).join(" ") : e instanceof Error ? e.message : String(e);
    await push("error", message).catch(() => {});
  } finally {
    phoneChats.delete(req.requestId);
  }
}

let started = false;

export function startPhoneLink(): void {
  if (started) return;
  started = true;
  // One sync at a time, in the order they arrive.
  let queue: Promise<void> = Promise.resolve();
  // A phone chatting through this computer counts as a conversation here.
  listen("lan:chat", () => void makeRoomForConversation()).catch(() => {});
  listen<ChatRequest>("lan:chat-request", (event) => void answerPhoneChat(event.payload)).catch(() => {});
  listen<{ requestId: string }>("lan:chat-cancel", (event) => phoneChats.get(event.payload.requestId)?.()).catch(() => {});
  listen<SyncRequest>("lan:request", (event) => {
    if (event.payload.kind !== "sync") return;
    noteConversation();
    queue = queue.then(() => handleSync(event.payload));
  }).catch(() => {});

  getSetting("lan_enabled")
    .then(async (on) => {
      if (on === "1") await setPhoneLink(true);
    })
    .catch(() => {});
}

/** One line for the sidebar, or null when the link is off. */
export async function linkSummary(): Promise<string | null> {
  const info = await lanInfo();
  if (!info.enabled) return null;
  const peers = await listSyncPeers();
  if (info.peers.length === 0) return "Phone sync on. No phone paired.";
  const last = peers.map((p) => p.last_sync_at).filter(Boolean).sort().pop() ?? null;
  return `Phone synced ${sinceLabel(last)}`;
}
