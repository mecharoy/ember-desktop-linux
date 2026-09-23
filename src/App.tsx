import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import UpdateBanner from "./components/UpdateBanner";
import WhatsNew from "./components/WhatsNew";
import Dock from "./components/Dock";
import Mycelium from "./components/Mycelium";
import Onboarding from "./components/Onboarding";
import QuickNote from "./components/QuickNote";
import Today from "./windows/Today";
import Journal from "./windows/Journal";
import Insights from "./windows/Insights";
import Settings from "./windows/Settings";
import type { JournalFocus } from "./windows/navigation";
import { firstRunScreen, type FirstRunScreen } from "./install";
import { localDateKey } from "./time";
import { conversationState } from "./db/sessions";
import { startScheduler } from "./scheduler";
import { backupIfDue } from "./backup";
import { startLocalModelKeeper } from "./localModel";
import { startPhoneLink, linkSummary } from "./lan/desktopLink";
import { captureHotkeyLabel } from "./platform";
import { BACK_TAB, useBackButton } from "./useBackButton";
import { startTypingWatch } from "./mascot/typing";
import { claim, release } from "./mascot/pulse";

/**
 * What the phone link is doing, in one line. It used to sit under the beetle
 * in the sidebar; with the sidebar gone the beetle carries it in the dock.
 */
function useLinkSummary(): string {
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
  return link ?? "Everything here stays on this computer.";
}

function App() {
  const [active, setActive] = useState("today");
  const [journalFocus, setJournalFocus] = useState<JournalFocus | null>(null);
  // The day the Today tab journals when not looking back. It follows the
  // calendar, except that a conversation still going at midnight keeps its
  // own day: swapping in a fresh session mid-conversation is how an evening
  // got lost before.
  const [liveDay, setLiveDay] = useState(() => localDateKey());
  // An earlier date picked in the Journal calendar ("Talk it through").
  const [pastDay, setPastDay] = useState<string | null>(null);
  // Bumped when the Journal tab deletes, moves or writes the entry of the day
  // Today shows, so Today reloads instead of chatting on into a stale session.
  const [todayVersion, setTodayVersion] = useState(0);
  const [firstRun, setFirstRun] = useState<FirstRunScreen | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const linkStatus = useLinkSummary();
  const liveDayRef = useRef(liveDay);
  liveDayRef.current = liveDay;
  const activeRef = useRef(active);
  activeRef.current = active;
  // Pages stay mounted once opened and are only hidden, so switching tabs
  // keeps what was typed, scrolled or opened on them.
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["today"]));
  useEffect(() => {
    setVisited((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);

  useEffect(() => {
    firstRunScreen().then(setFirstRun);
    startTypingWatch(); // the beetle listens while you write
    startScheduler(); // reminders, missed-day skips, weekly review
    startLocalModelKeeper(); // Ollama up and the model loaded, when local is chosen
    startPhoneLink(); // phones on the home network, when switched on
    backupIfDue();
  }, []);

  // Changing page: the beetle takes a short flight to the new one.
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    claim("nav", "flying");
    const t = setTimeout(() => release("nav"), 900);
    return () => {
      clearTimeout(t);
      release("nav");
    };
  }, [active]);

  // Back (mouse button or Alt+Left) from any other page returns to Today.
  useBackButton(active !== "today", () => setActive("today"), BACK_TAB);

  // Moves Today to the new day once the old one is safe to leave: its
  // conversation is wrapped up or never started, and, if there was one, you
  // aren't looking at it right now.
  useEffect(() => {
    const timer = setInterval(async () => {
      const now = localDateKey();
      const shown = liveDayRef.current;
      if (now === shown) return;
      const state = await conversationState(shown);
      if (state === "unfinished") return;
      if (state === "done" && activeRef.current === "today") return;
      setLiveDay(now);
      backupIfDue();
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  function openJournal(focus: JournalFocus) {
    setJournalFocus(focus);
    setActive("journal");
  }

  function handleSelect(page: string) {
    if (page === "journal") setJournalFocus(null); // manual tab click = unfiltered
    setActive(page);
  }

  function backToToday() {
    setPastDay(null);
    setLiveDay(localDateKey());
  }

  function talkAbout(date: string) {
    if (date === localDateKey()) backToToday();
    else setPastDay(date);
    setActive("today");
  }

  const dayShown = pastDay ?? liveDay;
  // Today is wider on a big screen, to fit the checklist beside the chat;
  // Settings stays at reading width.
  const column = "mx-auto h-full w-full max-w-5xl";
  const wideColumn = "mx-auto h-full w-full max-w-4xl";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ground text-fg">
      <Mycelium />
      <UpdateBanner />
      <main className="relative min-h-0 flex-1">
        {/* Today stays mounted and is only hidden: unmounting it would drop an
            in-flight counselor reply (and the draft) whenever the user looked at
            another page. Keyed by the day it shows, so a new day, or a past day
            opened from the Journal, still gets a fresh session. */}
        <div className={active === "today" ? "page absolute inset-0" : "hidden"}>
          <div className={column}>
            <Today
              key={`${dayShown}:${todayVersion}`}
              date={dayShown}
              active={active === "today"}
              onBackToToday={dayShown !== localDateKey() ? backToToday : undefined}
              onQuickNote={() => setNoteOpen(true)}
            />
          </div>
        </div>
        {visited.has("journal") && (
          <div className={active === "journal" ? "page absolute inset-0" : "hidden"}>
            <div className={wideColumn}>
              <Journal
                active={active === "journal"}
                focus={journalFocus}
                onClearFocus={() => setJournalFocus(null)}
                onDaysChanged={(dates) => {
                  if (dates.includes(dayShown)) setTodayVersion((v) => v + 1);
                }}
                onTalkAbout={talkAbout}
              />
            </div>
          </div>
        )}
        {visited.has("insights") && (
          <div className={active === "insights" ? "page absolute inset-0 overflow-y-auto" : "hidden"}>
            <div className="mx-auto w-full max-w-6xl">
              <Insights active={active === "insights"} onOpenJournal={openJournal} />
            </div>
          </div>
        )}
        {visited.has("settings") && (
          <div className={active === "settings" ? "page absolute inset-0 overflow-y-auto" : "hidden"}>
            <div className="mx-auto min-h-full w-full max-w-3xl">
              <Settings active={active === "settings"} />
            </div>
          </div>
        )}
      </main>
      <Dock
        active={active}
        onSelect={handleSelect}
        onQuickNote={() => setNoteOpen(true)}
        hint={captureHotkeyLabel()}
        status={linkStatus}
      />
      <QuickNote open={noteOpen} onClose={() => setNoteOpen(false)} />
      <NoteSheetBack open={noteOpen} onClose={() => setNoteOpen(false)} />
      {(firstRun === "setup" || firstRun === "welcome-back") && (
        <Onboarding welcomeBack={firstRun === "welcome-back"} onDone={() => setFirstRun("none")} />
      )}
      <WhatsNew screen={firstRun} />
    </div>
  );
}

/** Back, or Escape, closes the quick-note sheet. */
function NoteSheetBack({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackButton(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return null;
}

export default App;
