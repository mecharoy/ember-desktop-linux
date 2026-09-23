import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isReminderBannerVisible, skipTonight, snoozeReminder } from "../scheduler";
import Wingbeat from "./Wingbeat";

/** The in-app face of the evening reminder: visible whenever the
 * reminder slot is open, with the snooze options the OS notification can't
 * reliably carry. */
export default function ReminderBanner({ onTalk }: { onTalk?: () => void }) {
  const [visible, setVisible] = useState(false);

  async function refresh() {
    setVisible(await isReminderBannerVisible());
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60_000);
    const unlistens = [listen("reminder:fired", refresh), listen("reminder:changed", refresh)];
    return () => {
      clearInterval(timer);
      unlistens.forEach((u) => u.then((f) => f()));
    };
  }, []);

  if (!visible) return null;

  async function handleSnooze(minutes: number) {
    await snoozeReminder(minutes);
    setVisible(false);
  }

  async function handleSkip() {
    await skipTonight();
    setVisible(false);
  }

  return (
    <div className="ink-in flex flex-col gap-3 rounded-xl bg-moss-wash/60 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Wingbeat />
        <span className="flex-1 font-serif text-[17px] text-fg">Ready to talk about today?</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {onTalk && (
          <button onClick={onTalk} className="btn-primary mr-1 min-h-[38px] px-4 py-1.5 text-[14px]">
            Let&rsquo;s talk
          </button>
        )}
        <button onClick={() => handleSnooze(30)} className="btn-ghost min-h-[38px] px-2.5">
          In 30 min
        </button>
        <button onClick={() => handleSnooze(60)} className="btn-ghost min-h-[38px] px-2.5">
          In an hour
        </button>
        <button onClick={handleSkip} className="btn-ghost min-h-[38px] px-2.5">
          Not today
        </button>
      </div>
    </div>
  );
}
