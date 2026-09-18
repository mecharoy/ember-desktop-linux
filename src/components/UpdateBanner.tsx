import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSetting, setSetting } from "../db/settings";
import { checkForUpdate, type Release } from "../update/update";

/**
 * Looks for a newer release once when Ember opens and, only if there is one,
 * shows a card at the top. Download opens the installer in the browser; Later
 * hides that version until the next one.
 */
export default function UpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if ((await getSetting("update_auto_check")) !== "1") return;
      const result = await checkForUpdate(false);
      if (!cancelled && result.status === "available") setRelease(result.release);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!release) return null;

  return (
    <div className="fade-up sticky top-0 z-20 border-b border-rule bg-sheet/95 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ember" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-snug text-ink">Ember {release.version} is ready</p>
          {release.notes && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-faint">{release.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              setSetting("update_dismissed_version", release.version).catch(() => {});
              setRelease(null);
            }}
            className="btn-ghost !min-h-[36px] !px-3"
          >
            Later
          </button>
          <button
            onClick={() => openUrl(release.downloadUrl).catch(() => {})}
            className="btn-primary !min-h-[36px] !px-4 !py-1.5 !text-[13.5px]"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
