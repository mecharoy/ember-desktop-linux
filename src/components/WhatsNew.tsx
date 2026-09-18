import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getSetting, setSetting } from "../db/settings";
import { decideWhatsNew, notesFor, type Highlight } from "../update/whatsNew";
import { useBackButton } from "../useBackButton";
import type { FirstRunScreen } from "../install";

/**
 * Shown once after an update: what changed, or just "Bug fixes" for a small
 * release. On the first-run screens it only notes the version, so a new
 * install never opens with a list of changes.
 */
export default function WhatsNew({ screen }: { screen: FirstRunScreen | null }) {
  const [card, setCard] = useState<{ version: string; items: Highlight[] } | null>(null);

  useEffect(() => {
    if (!screen) return;
    let cancelled = false;
    (async () => {
      try {
        const [current, seen] = await Promise.all([getVersion(), getSetting("last_seen_version")]);
        const decision = decideWhatsNew({ seen, current, fresh: screen !== "none" });
        if (decision === "remember") await setSetting("last_seen_version", current);
        if (decision === "show" && !cancelled) setCard({ version: current, items: notesFor(current) });
      } catch {
        // Not worth interrupting anyone over.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen]);

  function close() {
    if (card) setSetting("last_seen_version", card.version).catch(() => {});
    setCard(null);
  }

  useBackButton(card !== null, close);

  if (!card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Close" onClick={close} className="fade-in absolute inset-0 bg-ink/30" />
      <div
        role="dialog"
        aria-label={`What's new in Ember ${card.version}`}
        className="sheet-up relative flex max-h-[85%] w-full max-w-md flex-col rounded-t-2xl border border-rule bg-sheet shadow-[0_-8px_30px_-12px_rgba(40,35,30,0.35)] sm:rounded-2xl"
      >
        <div className="px-6 pb-3 pt-6">
          <p className="text-[12.5px] uppercase tracking-[0.14em] text-ember">Updated to {card.version}</p>
          <h2 className="mt-1 font-serif text-[24px] leading-tight text-ink">What&rsquo;s new</h2>
        </div>
        <ul className="flex flex-col gap-4 overflow-y-auto px-6 pb-4">
          {card.items.map((h) => (
            <li key={h.title} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ember" aria-hidden="true" />
              <div>
                <p className="text-[15px] font-medium text-ink">{h.title}</p>
                <p className="mt-0.5 text-[14px] leading-relaxed text-ink-soft">{h.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-rule px-6 py-4">
          <button onClick={close} className="btn-primary w-full">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
