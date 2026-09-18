import { openUrl } from "@tauri-apps/plugin-opener";

/** A service's key page, opened in the phone's browser. Shows the address
 *  without "https://" so it reads like the text it replaces. */
export default function KeyLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        openUrl(url).catch(() => {});
      }}
      className="break-all text-ember underline decoration-ember/40 underline-offset-2"
    >
      {url.replace(/^https:\/\//, "")}
    </a>
  );
}
