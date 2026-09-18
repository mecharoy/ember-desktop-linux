import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { lanInfo, removePhone, setPhoneLink, startPairing, stopPairing, type LanInfo } from "../../lan/desktopLink";
import { listSyncPeers, type SyncPeer } from "../../db/sync";
import { sinceLabel } from "../../lan/syncEvents";

/** Pairing phones on the same network with this computer. */
export default function PhoneLinkSettings() {
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [synced, setSynced] = useState<SyncPeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function refresh() {
    try {
      setInfo(await lanInfo());
      setSynced(await listSyncPeers());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
    const unlisten = listen("lan:peers-changed", refresh);
    const unlistenSync = listen("sync:applied", refresh);
    return () => {
      unlisten.then((u) => u());
      unlistenSync.then((u) => u());
    };
  }, []);

  // The code runs out; count it down while it's shown.
  useEffect(() => {
    if (!info?.pairingCode) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [info?.pairingCode]);

  async function run(action: () => Promise<LanInfo>) {
    setWorking(true);
    setError(null);
    try {
      setInfo(await action());
      setSynced(await listSyncPeers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  if (!info) return <p className="hint">Loading&hellip;</p>;

  const address = info.addresses[0] ? `${info.addresses[0]}:${info.port}` : null;
  const minutes = info.pairingSecondsLeft !== null ? Math.ceil(info.pairingSecondsLeft / 60) : 0;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4">
        <span className="label">
          Allow phone sync
          <span className="hint mt-0.5 block">Syncs your journal and lets the phone chat through this computer&rsquo;s AI provider.</span>
        </span>
        <input
          type="checkbox"
          checked={info.enabled}
          disabled={working}
          onChange={(e) => run(() => setPhoneLink(e.target.checked))}
          className="h-5 w-5 shrink-0 accent-ember"
        />
      </label>

      {info.enabled && (
        <>
          <p className="hint">
            {info.name}
            {address && <span className="tabular-nums"> &middot; {address}</span>}
            <br />
            Both devices must be on the same network. Campus and office Wi-Fi often block this; use your phone&rsquo;s
            hotspot instead. If a firewall asks (or blocks it), allow Ember on the network: TCP 47821 and UDP 47820.
          </p>

          {info.pairingCode ? (
            <div className="fade-up flex flex-col items-start gap-1.5 rounded-xl border border-ember/40 bg-ember-wash/40 px-4 py-3.5">
              <span className="text-[13.5px] text-ink-soft">On your phone: Settings &rsaquo; Sync with computer &rsaquo; enter</span>
              <span className="select-text font-serif text-[32px] tracking-[0.12em] text-ink tabular-nums">{info.pairingCode}</span>
              <span className="hint">
                Expires in {minutes} min.
                {address && ` Address: ${address}`}
              </span>
              <button onClick={() => run(stopPairing)} className="btn-ghost -ml-3">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => run(startPairing)} disabled={working} className="btn-subtle self-start">
              {working ? "Preparing…" : "Pair a phone"}
            </button>
          )}

          {info.peers.length > 0 && (
            <ul className="flex flex-col">
              {info.peers.map((p) => {
                const s = synced.find((x) => x.peer_id === p.id);
                return (
                  <li key={p.id} className="flex items-center gap-3 border-b border-rule/70 py-2.5 last:border-b-0">
                    <span className="flex-1 text-[15px] text-ink">
                      {p.name || "Phone"}
                      <span className="block text-[12.5px] text-ink-faint">Last synced {sinceLabel(s?.last_sync_at ?? null)}</span>
                    </span>
                    <button onClick={() => run(() => removePhone(p.id))} className="btn-ghost">
                      Unpair
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

        </>
      )}
      {(error || info.error) && <p className="text-[13.5px] text-danger">{error ?? info.error}</p>}
    </div>
  );
}
