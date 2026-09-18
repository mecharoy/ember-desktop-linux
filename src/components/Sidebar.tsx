import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { NavIcon, TABS } from "./BottomNav";
import { captureHotkeyLabel } from "../platform";
import { linkSummary } from "../lan/desktopLink";

interface SidebarProps {
  active: string;
  onSelect: (tab: string) => void;
  onQuickNote: () => void;
}

/** Height of one tab row; the marker slides between rows in these steps. */
const ROW_PX = 40;

/** The desktop's navigation: the phone's four tabs, down the left side. */
export default function Sidebar({ active, onSelect, onQuickNote }: SidebarProps) {
  const index = Math.max(0, TABS.findIndex((t) => t.id === active));
  const slide = { transform: `translateY(${index * ROW_PX}px)` };
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => linkSummary().then(setLink).catch(() => setLink(null));
    refresh();
    const timer = setInterval(refresh, 30_000);
    const unlisten = listen("lan:peers-changed", refresh);
    const unlistenSync = listen("sync:applied", refresh);
    return () => {
      clearInterval(timer);
      unlisten.then((u) => u());
      unlistenSync.then((u) => u());
    };
  }, []);

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-rule px-4 pb-6 pt-8" aria-label="Sections">
      <div className="mb-8 flex items-center gap-2 px-3">
        <img src="/logo-mark.png" alt="" aria-hidden="true" draggable={false} className="h-7 w-7 select-none" />
        <span className="font-serif text-[24px] leading-none tracking-[-0.02em] text-ink">Ember</span>
      </div>

      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 rounded-lg bg-paper-deep transition-transform duration-300 ease-settle"
          style={{ ...slide, height: ROW_PX }}
        />
        <span
          aria-hidden="true"
          className="absolute left-0 top-[12px] h-[16px] w-[2px] rounded-full bg-ember transition-transform duration-300 ease-settle"
          style={slide}
        />
        <ul className="relative flex flex-col">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <button
                onClick={() => onSelect(tab.id)}
                aria-current={active === tab.id ? "page" : undefined}
                className={`flex w-full items-center gap-3 px-3 text-left text-[14.5px] transition-colors duration-200 ${
                  active === tab.id ? "text-ink" : "text-ink-faint hover:text-ink"
                }`}
                style={{ height: ROW_PX }}
              >
                <NavIcon id={tab.id} />
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <button onClick={onQuickNote} className="btn-subtle mt-6 justify-start gap-2 px-3">
        <span className="text-[18px] leading-none text-ember" aria-hidden="true">
          +
        </span>
        Quick note
        <span className="text-[12px] text-ink-faint">({captureHotkeyLabel()})</span>
      </button>

      <p className="mt-auto px-3 text-[12px] leading-relaxed text-ink-faint">{link ?? "Stays on your own devices."}</p>
    </nav>
  );
}
