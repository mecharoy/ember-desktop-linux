import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onThemeChange } from "../theme";
import { listCaptureTimesSince } from "../db/captures";
import { localDateKey } from "../time";
import { computeStreak, listEntries } from "../db/entries";
import { listAllDayMetrics } from "../db/metrics";
import { addTrackedHabit, listObservations, pinHabit, setObservationDetail, setObservationPinned } from "../db/observations";
import { deleteTopic, listTopics, setTopicStatus } from "../db/topics";
import { findPatterns, loadPatterns, type Patterns, type Suggestion } from "../ai/patterns";
import SuggestionsModule from "../components/insights/SuggestionsModule";
import { listMonthlyReports, listWeeklyReviews } from "../db/reviews";
import { listHabitPrefs, setHabitDirection, setHabitDismissed } from "../db/habitPrefs";
import { getSetting } from "../db/settings";
import { listCheckIns } from "../db/checkins";
import { listAssessments } from "../db/assessments";
import { listMemorySummaries } from "../db/memorySummaries";
import type {
  Assessment,
  CheckIn,
  DayMetrics,
  Entry,
  HabitPref,
  Instrument,
  MemorySummary,
  MonthlyReport,
  Observation,
  Topic,
  WeeklyReview,
} from "../db/types";
import { parseEnabledInstruments } from "../insights/assessments";
import { countTimedNights, SLEEP_MIN_NIGHTS } from "../insights/sleep";
import { routineSummary } from "../insights/routine";
import WellbeingModule from "../components/insights/WellbeingModule";
import SleepModule from "../components/insights/SleepModule";
import RoutineModule from "../components/insights/RoutineModule";
import ActivitiesModule from "../components/insights/ActivitiesModule";
import ThinkingModule from "../components/insights/ThinkingModule";
import { listen } from "@tauri-apps/api/event";
import { reanalyseAllEntries, retryMissingExtractions, type ExtractionRepair } from "../ai/extractor";
import { runReviewJobsAndNotify, type ReviewJobsResult } from "../ai/reviewJobs";
import {
  addDays,
  computeUnlocks,
  computeVitals,
  isCurrent,
  parseDayRows,
  recentRows,
  peopleStats,
  themeStats,
  type KeyedSeries,
} from "../insights/stats";
import type { JournalFocus } from "./navigation";
import { LockedModule } from "../components/insights/ModuleCard";
import VitalsRow from "../components/insights/VitalsRow";
import MoodEnergyChart from "../components/insights/MoodEnergyChart";
import TopicMonthDialog from "../components/insights/TopicMonthDialog";
import WeekRhythm from "../components/insights/WeekRhythm";
import KeyedRows from "../components/insights/KeyedRows";
import { ModuleCard } from "../components/insights/ModuleCard";
import HabitsModule from "../components/insights/HabitsModule";
import MoodMovers from "../components/insights/MoodMovers";
import EmotionVocab from "../components/insights/EmotionVocab";
import ReviewsModule from "../components/insights/ReviewsModule";
import { useMascotClaim } from "../mascot/pulse";
import Recap from "../components/insights/Recap";

interface Loaded {
  metrics: DayMetrics[];
  entries: Entry[];
  streak: number;
  captureTimes: string[];
  habitObservations: Observation[];
  habitPrefs: HabitPref[];
  reviews: WeeklyReview[];
  monthly: MonthlyReport[];
  hidden: Set<string>;
  checkins: CheckIn[];
  assessments: Assessment[];
  summaries: MemorySummary[];
  enabledInstruments: Instrument[];
  /** What the last background review run couldn't write, "" if nothing. */
  jobsError: string;
  patterns: Patterns | null;
  topics: Topic[];
}

const plural = (n: number) => `${n} entr${n === 1 ? "y" : "ies"}`;

/** One line telling the user what the refresh actually did. */
function describeRefresh(repair: ExtractionRepair, jobs: ReviewJobsResult): string {
  const parts: string[] = [];
  const done = repair.attempted - repair.failed;
  if (done > 0) parts.push(`Re-read ${plural(done)}.`);
  const unread = repair.failed + repair.skipped;
  if (unread > 0) {
    parts.push(`${plural(unread)} couldn't be read. Check the AI provider in Settings, then try again.`);
  }
  if (jobs.weekly?.ok) parts.push("Wrote the weekly review.");
  else if (jobs.weekly) parts.push("The weekly review couldn't be written. It will try again by itself.");
  if (jobs.monthly?.ok) parts.push("Wrote the monthly report.");
  else if (jobs.monthly) parts.push("The monthly report couldn't be written. It will try again by itself.");
  if (jobs.fortnightly?.ok) parts.push("Updated Elytra's memory summary.");
  else if (jobs.fortnightly) parts.push("The memory summary couldn't be written. It will try again by itself.");
  return parts.length > 0 ? parts.join(" ") : "Up to date.";
}

export default function Insights({
  onOpenJournal,
  active = true,
}: {
  onOpenJournal: (focus: JournalFocus) => void;
  /** The page stays mounted between visits; it reloads on each return. */
  active?: boolean;
}) {
  // Chart colours are module state (components/insights/palette.ts), and a
  // module that swaps them cannot tell React anything. This re-renders the
  // page when the theme changes so every chart picks up its new set.
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);
  const [patternsState, setPatternsState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  // Re-reading the days is the beetle LOADING — a state of its own, so the
  // long waits in the app are told apart at a glance rather than all looking
  // like thinking.
  const [data, setData] = useState<Loaded | null>(null);
  const [refreshState, setRefreshState] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });
  const [confirmReanalyse, setConfirmReanalyse] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  // The theme or person opened day by day from its small chart.
  const [expanded, setExpanded] = useState<{ group: "themes" | "people"; item: KeyedSeries } | null>(null);
  const today = localDateKey();

  async function refresh() {
    const [
      metrics,
      entries,
      streak,
      captureTimes,
      habitObservations,
      habitPrefs,
      reviews,
      monthly,
      hiddenCsv,
      checkins,
      assessments,
      summaries,
      enabledCsv,
      jobsError,
      patterns,
      topics,
    ] = await Promise.all([
      listAllDayMetrics(),
      listEntries(),
      computeStreak(),
      listCaptureTimesSince(addDays(localDateKey(), -90)),
      listObservations("habit"),
      listHabitPrefs(),
      listWeeklyReviews(),
      listMonthlyReports(),
      getSetting("hidden_modules"),
      listCheckIns(),
      listAssessments(),
      listMemorySummaries(),
      getSetting("assessments_enabled"),
      getSetting("jobs_last_error"),
      loadPatterns(),
      listTopics(),
    ]);
    const hidden = new Set(hiddenCsv.split(",").map((s) => s.trim()).filter(Boolean));
    setData({
      metrics,
      entries,
      streak,
      captureTimes,
      habitObservations,
      habitPrefs,
      reviews,
      monthly,
      hidden,
      checkins,
      assessments,
      summaries,
      enabledInstruments: parseEnabledInstruments(enabledCsv),
      jobsError,
      patterns,
      topics,
    });
  }

  useEffect(() => {
    if (active) refresh();
  }, [active]);

  useEffect(() => {
    // the scheduler runs the review jobs; the extractor runs in the
    // background after each save — reload whenever either one lands
    const unlistenReviews = listen("reviews:updated", () => refresh());
    const unlistenInsights = listen("insights:updated", () => refresh());
    return () => {
      unlistenReviews.then((u) => u());
      unlistenInsights.then((u) => u());
    };
  }, []);

  /** Refresh: re-read entries whose analysis failed or never ran ("missing"),
   * or re-analyse every entry with the current extractor ("all"); then run
   * any due review job and reload. Each step is a no-op when nothing is due. */
  // Re-reading every entry can take a while; the beetle carries the wait.
  useMascotClaim("patterns", "loading", refreshState.busy);

  async function runRepair(kind: "missing" | "all") {
    setConfirmReanalyse(false);
    setRefreshState({ busy: true, message: "Checking your entries…" });
    try {
      const progress = (done: number, total: number) =>
        setRefreshState({ busy: true, message: `Re-reading entries… ${done + 1}/${total}` });
      const repair = kind === "all" ? await reanalyseAllEntries(progress) : await retryMissingExtractions(progress);
      setRefreshState({ busy: true, message: "Checking reviews…" });
      const jobs = await runReviewJobsAndNotify();
      await refresh();
      setRefreshState({ busy: false, message: describeRefresh(repair, jobs) });
    } catch (e) {
      setRefreshState({ busy: false, message: `Refresh failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const rows = useMemo(() => (data ? parseDayRows(data.metrics) : []), [data]);
  const entryDates = useMemo(() => (data ? data.entries.map((e) => e.date) : []), [data]);
  const themes = useMemo(() => themeStats(rows, today), [rows, today]);
  const people = useMemo(() => peopleStats(rows, today), [rows, today]);
  // Comparisons count the last three months, not all history (see stats.ts).
  const recent = useMemo(() => recentRows(rows, today), [rows, today]);
  const dismissed = useMemo(
    () => new Set((data?.habitPrefs ?? []).filter((p) => p.dismissed === 1).map((p) => p.key)),
    [data],
  );

  if (!data) {
    return <p className="px-5 pt-6 text-[14px] text-fg-faint">Loading&hellip;</p>;
  }

  const unlocks = computeUnlocks(entryDates);
  const vitals = computeVitals(rows, entryDates, data.captureTimes, today);
  const entryDateSet = new Set(entryDates);
  const n = entryDates.length;

  const openEntry = (date: string) => onOpenJournal({ label: null, dates: [date] });

  async function handlePin(obs: Observation, pinned: boolean) {
    await setObservationPinned(obs.id, pinned);
    refresh();
  }

  async function handlePinDiscovered(key: string) {
    await pinHabit(key).catch(() => {});
    refresh();
  }

  async function handleDismiss(key: string, isDismissed: boolean) {
    await setHabitDismissed(key, isDismissed);
    if (!isDismissed) {
      // A restored habit comes back among the ones spotted in the entries. One
      // that never appeared in an entry (a suggestion they took up) has no
      // place there, so it goes back to being tracked.
      const canonical = key.trim().toLowerCase();
      const inEntries = rows.some((r) => r.x.habits.some((h) => h.done && h.key.trim().toLowerCase() === canonical));
      if (!inEntries) {
        const old = data?.habitObservations.find((o) => o.key.trim().toLowerCase() === canonical);
        await addTrackedHabit(old?.key ?? key, today, old?.detail ?? undefined);
      }
    }
    refresh();
  }

  async function handleDescribe(obs: Observation, text: string) {
    await setObservationDetail(obs.id, text);
    refresh();
  }

  async function handleDirection(key: string, direction: "less" | null) {
    await setHabitDirection(key, direction);
    refresh();
  }

  async function handleFindPatterns() {
    setPatternsState({ busy: true, message: null });
    try {
      const r = await findPatterns();
      setPatternsState({ busy: false, message: r.ok ? null : `Couldn't read them: ${r.error}` });
      await refresh();
    } catch (e) {
      setPatternsState({ busy: false, message: `Couldn't read them: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function handleTrackSuggestion(s: Suggestion, name: string, description: string) {
    // Adding a habit they once marked "not a habit" brings it back.
    await setHabitDismissed(name, false);
    await addTrackedHabit(name, today, description.trim());
    if (s.kind === "cut back") await setHabitDirection(name, "less");
    await refresh();
  }

  const timedNights = countTimedNights(data.checkins);
  const routineOpen = routineSummary(rows, data.checkins, today).latest !== null;
  const anyActivities = rows.some((r) => r.x.activities.length > 0);
  const openDates = (label: string, dates: string[]) => onOpenJournal({ label, dates });

  const anyPinned = data.habitObservations.some((o) => o.pinned === 1);
  const anyDiscovered = rows.some((r) => r.x.habits.some((h) => h.done)) || dismissed.size > 0;

  // A section either has enough days behind it or is still gathering them.
  // The ones still gathering are collected at the end, in one place, instead
  // of breaking up the ones that have something to say.
  const gathering: ReactNode[] = [];
  const show = (id: string, ready: boolean, node: ReactNode, locked: ReactNode): ReactNode => {
    if (data.hidden.has(id)) return null;
    if (ready) return <Fragment key={id}>{node}</Fragment>;
    gathering.push(<Fragment key={id}>{locked}</Fragment>);
    return null;
  };

  const moodSections = [
    show(
      "mood",
      unlocks.moodChart,
      <MoodEnergyChart rows={rows} todayKey={today} entryDates={entryDateSet} onOpenEntry={openEntry} />,
      <LockedModule title="Mood & energy over time" teaser="Where your weeks are really heading." have={n} need={5} />,
    ),
    show(
      "rhythm",
      unlocks.weekRhythm,
      <WeekRhythm rows={recent} captureTimes={data.captureTimes} />,
      <LockedModule
        title="Week rhythm"
        teaser="Sunday dips, midweek slumps, and the hour your thoughts come out."
        have={n}
        need={14}
      />,
    ),
    show(
      "movers",
      unlocks.moodMovers,
      <MoodMovers
        rows={recent}
        dismissedHabits={dismissed}
        onOpen={(f) => onOpenJournal({ label: "mood pattern", dates: f.dates })}
      />,
      <LockedModule title="What moves your mood" teaser="What your better days have in common." have={n} need={30} />,
    ),
  ].filter(Boolean);

  const whoAndWhat = [
    show(
      "themes",
      unlocks.themes,
      <ModuleCard title="Themes">
        <CurrentAndEarlier
          items={themes}
          today={today}
          empty="Nothing has come up more than once in the last month."
          render={(items) => (
            <KeyedRows
              items={items.slice(0, 10)}
              showTrend
              onOpen={(t) => onOpenJournal({ label: `theme: ${t.key}`, dates: t.dates })}
              onExpand={(t) => setExpanded({ group: "themes", item: t })}
            />
          )}
          onOpenEarlier={(t) => onOpenJournal({ label: `theme: ${t.key}`, dates: t.dates })}
        />
      </ModuleCard>,
      <LockedModule title="Themes" teaser="What keeps coming back, and what's fading." have={n} need={10} />,
    ),
    show(
      "people",
      unlocks.people,
      <ModuleCard title="People">
        <CurrentAndEarlier
          items={people}
          today={today}
          empty="Nobody has come up in the last month."
          render={(items) => (
            <KeyedRows
              items={items.slice(0, 10)}
              showTrend={false}
              onOpen={(p) => onOpenJournal({ label: `person: ${p.key}`, dates: p.dates })}
              onExpand={(p) => setExpanded({ group: "people", item: p })}
            />
          )}
          onOpenEarlier={(p) => onOpenJournal({ label: `person: ${p.key}`, dates: p.dates })}
        />
      </ModuleCard>,
      <LockedModule title="People" teaser="Who fills your days." have={n} need={10} />,
    ),
  ].filter(Boolean);

  const daySections = [
    whoAndWhat.length > 0 ? (
      <div key="who" className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        {whoAndWhat}
      </div>
    ) : null,
    // The pin UI must be reachable, so habits show once any habit has been
    // discovered (or dismissed, so it can be restored).
    show(
      "habits",
      anyPinned || anyDiscovered,
      <HabitsModule
        rows={rows}
        todayKey={today}
        journaledDates={entryDateSet}
        habitObservations={data.habitObservations}
        habitPrefs={data.habitPrefs}
        onPin={handlePin}
        onPinDiscovered={handlePinDiscovered}
        onDismiss={handleDismiss}
        onDescribe={handleDescribe}
        onDirection={handleDirection}
        patterns={data.patterns}
        patternsState={patternsState}
        onFindPatterns={handleFindPatterns}
      />,
      <LockedModule title="Habits" teaser="The gym, the late-night scroll: whatever you keep doing shows up here." />,
    ),
    show(
      "activities",
      n >= 10 && anyActivities,
      <ActivitiesModule rows={recent} todayKey={today} onOpen={openDates} />,
      <LockedModule title="Activities & mood" teaser="What actually lifts you." have={n} need={10} />,
    ),
  ].filter(Boolean);

  const bodySections = [
    show(
      "sleep",
      timedNights >= SLEEP_MIN_NIGHTS,
      <SleepModule diary={data.checkins} rows={rows} todayKey={today} onOpen={(f) => openDates("sleep", f.dates)} />,
      <LockedModule
        title="Sleep"
        teaser="How steady your nights are. Counts nights with a bedtime and wake time."
        have={timedNights}
        need={SLEEP_MIN_NIGHTS}
      />,
    ),
    show(
      "routine",
      routineOpen,
      <RoutineModule rows={rows} diary={data.checkins} todayKey={today} onOpen={openDates} />,
      <LockedModule title="Daily routine" teaser="How well your days keep their rhythm." />,
    ),
  ].filter(Boolean);

  const mindSections = [
    show(
      "emotions",
      unlocks.emotions,
      <EmotionVocab rows={rows} todayKey={today} />,
      <LockedModule
        title="Emotional vocabulary"
        teaser="Most people name three feelings. You probably have more."
        have={n}
        need={20}
      />,
    ),
    show(
      "thinking",
      n >= 10,
      <ThinkingModule rows={rows} todayKey={today} onOpen={openDates} />,
      <LockedModule
        title="Thinking patterns"
        teaser="The stories your mind tells on repeat, in your own words."
        have={n}
        need={10}
      />,
    ),
    // Always reachable, so the questionnaires can be taken or turned on.
    data.hidden.has("wellbeing") ? null : (
      <WellbeingModule
        key="wellbeing"
        assessments={data.assessments}
        enabled={data.enabledInstruments}
        todayKey={today}
        onChanged={refresh}
      />
    ),
  ].filter(Boolean);

  const letterSections = [
    data.hidden.has("reviews") ? null : (
      <ReviewsModule
        key="reviews"
        reviews={data.reviews}
        monthly={data.monthly}
        summaries={data.summaries}
        entryDates={entryDates}
        onOpen={(label, dates) => onOpenJournal({ label: `review: ${label}`, dates })}
        onChanged={refresh}
        topics={data.topics}
        onTopicStatus={async (key, status) => {
          await setTopicStatus(key, status);
          refresh();
        }}
        onTopicRemove={async (key) => {
          await deleteTopic(key);
          refresh();
        }}
      />
    ),
    data.hidden.has("suggestions") ? null : (
      <SuggestionsModule
        key="suggestions"
        patterns={data.patterns}
        state={patternsState}
        trackedHabits={
          new Set(data.habitObservations.filter((o) => o.pinned === 1).map((o) => o.key.trim().toLowerCase()))
        }
        onFind={handleFindPatterns}
        onTrack={handleTrackSuggestion}
      />
    ),
  ].filter(Boolean);

  const chapters: { id: string; title: string; lead: string; body: ReactNode[] }[] = [
    { id: "mood", title: "Mood", lead: "How you've felt, and what seems to move it.", body: moodSections },
    { id: "days", title: "Your days", lead: "What keeps coming up, and who is in it.", body: daySections },
    { id: "body", title: "Body & rhythm", lead: "Sleep, and the shape of an ordinary day.", body: bodySections },
    { id: "mind", title: "Mind", lead: "The words you use, and the stories you tell yourself.", body: mindSections },
    { id: "letters", title: "Letters & ideas", lead: "What Elytra has written back to you.", body: letterSections },
  ].filter((c) => c.body.length > 0);
  if (gathering.length > 0) {
    chapters.push({
      id: "gathering",
      title: "Still gathering",
      lead: "These open as you write up more days.",
      body: [
        <div key="grid" className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {gathering}
        </div>,
      ],
    });
  }

  const jumpTo = (id: string) =>
    document.getElementById(`patterns-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex flex-col gap-8 px-5 pb-16 pt-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Patterns</h1>
          <p className="page-subtitle">What your days have in common.</p>
        </div>
        <UpkeepMenu
          busy={refreshState.busy}
          entries={n}
          confirming={confirmReanalyse}
          onConfirm={setConfirmReanalyse}
          onRun={runRepair}
        />
      </header>

      {(refreshState.message || data.jobsError) && (
        <StatusLine
          message={refreshState.message}
          busy={refreshState.busy}
          jobsError={data.jobsError}
          onRetry={() => runRepair("missing")}
        />
      )}

      {/* The one thing to press on this page. */}
      <section className="fade-up flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-2xl bg-speak px-5 py-5 text-speak-fg shadow-[var(--lift-2)] sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-speak-fg/75">Recap</p>
          <p className="mt-1.5 font-serif text-[27px] leading-[1.1] tracking-[-0.01em]">Your week, in a minute.</p>
          <p className="mt-1.5 text-[14px] leading-snug text-speak-fg/80">
            {n === 0
              ? "Write up a day first, and there will be something to play."
              : "The highlights, one at a time. Nothing leaves this device."}
          </p>
        </div>
        <button
          onClick={() => setRecapOpen(true)}
          disabled={n === 0}
          className="inline-flex min-h-[46px] shrink-0 items-center gap-2.5 rounded-full bg-speak-fg px-5 text-[15px] font-medium text-speak transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
        >
          <svg viewBox="0 0 12 14" className="h-3.5 w-3" aria-hidden="true">
            <path d="M1 1.2v11.6c0 .5.6.8 1 .5l9-5.8a.6.6 0 0 0 0-1L2 .7c-.4-.3-1 0-1 .5Z" fill="currentColor" />
          </svg>
          Play
        </button>
      </section>

      <VitalsRow vitals={vitals} streak={data.streak} />

      {chapters.length > 1 && (
        <nav
          aria-label="Sections"
          className="sticky top-0 z-20 -mx-5 flex gap-1.5 overflow-x-auto [scrollbar-width:none] border-b border-line bg-ground/95 px-5 py-2.5"
        >
          {chapters.map((c) => (
            <button key={c.id} onClick={() => jumpTo(c.id)} className="btn-chip shrink-0">
              {c.title}
            </button>
          ))}
        </nav>
      )}

      {chapters.map((c) => (
        <section key={c.id} id={`patterns-${c.id}`} className="flex scroll-mt-16 flex-col gap-9 pt-2">
          <header>
            <h2 className="font-serif text-[30px] leading-[1.1] tracking-[-0.015em] text-fg">{c.title}</h2>
            <p className="mt-1 text-[14.5px] leading-snug text-fg-dim">{c.lead}</p>
          </header>
          {c.body}
        </section>
      ))}

      {expanded && (
        <TopicMonthDialog
          group={expanded.group}
          name={expanded.item.key}
          rows={rows}
          todayKey={today}
          entryDates={entryDateSet}
          onOpenEntry={(date) => {
            setExpanded(null);
            openEntry(date);
          }}
          onOpenEntries={() => {
            const { group, item } = expanded;
            setExpanded(null);
            onOpenJournal({ label: `${group === "themes" ? "theme" : "person"}: ${item.key}`, dates: item.dates });
          }}
          onClose={() => setExpanded(null)}
        />
      )}

      {recapOpen && (
        <Recap
          input={{
            today,
            rows,
            entries: data.entries,
            checkins: data.checkins,
            captureTimes: data.captureTimes,
            streak: data.streak,
            suggestions: (data.patterns?.suggestions ?? []).map((s) => s.title),
          }}
          onClose={() => setRecapOpen(false)}
          onOpenEntry={openEntry}
        />
      )}
    </div>
  );
}

/** Upkeep that used to sit at the top of the page, tucked behind one button. */
function UpkeepMenu({
  busy,
  entries,
  confirming,
  onConfirm,
  onRun,
}: {
  busy: boolean;
  entries: number;
  confirming: boolean;
  onConfirm: (v: boolean) => void;
  onRun: (kind: "missing" | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        onConfirm(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, onConfirm]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Refresh and re-read"
        title="Refresh and re-read"
        className="btn-ghost h-10 w-10 !px-0 text-[20px] leading-none text-fg-dim"
      >
        {busy ? <span className="text-[13px]">&hellip;</span> : "⋯"}
      </button>
      {open && (
        <div className="fade-up absolute right-0 top-full z-30 mt-2 flex w-[290px] flex-col gap-1 rounded-xl border border-line-strong bg-surface p-2 shadow-[var(--lift-3)]">
          <button
            onClick={() => {
              setOpen(false);
              onRun("missing");
            }}
            disabled={busy}
            className="flex flex-col items-start rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-high disabled:opacity-40"
          >
            <span className="text-[14.5px] text-fg">Refresh</span>
            <span className="text-[12.5px] leading-snug text-fg-faint">
              Re-read entries that failed, and write any review that&rsquo;s due.
            </span>
          </button>
          {confirming ? (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-high p-3 text-[13.5px] leading-snug text-fg-dim">
              <span>
                Re-read all {entries} entries? Up to {entries * 2} AI calls. Your entries stay as they are.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setOpen(false);
                    onRun("all");
                  }}
                  className="btn-subtle"
                >
                  Re-read
                </button>
                <button onClick={() => onConfirm(false)} className="btn-ghost">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onConfirm(true)}
              disabled={busy || entries === 0}
              className="flex flex-col items-start rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-high disabled:opacity-40"
            >
              <span className="text-[14.5px] text-fg">Re-read every entry</span>
              <span className="text-[12.5px] leading-snug text-fg-faint">
                Redo what Elytra took from them, with the current analysis.
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What a refresh did, or that background writing failed: one quiet line,
 *  with the technical reason a tap away instead of across the page. */
function StatusLine({
  message,
  busy,
  jobsError,
  onRetry,
}: {
  message: string | null;
  busy: boolean;
  jobsError: string;
  onRetry: () => void;
}) {
  const [details, setDetails] = useState(false);
  if (message) {
    return (
      <p className="-mt-4 text-[13.5px] leading-snug text-fg-faint" aria-live="polite">
        {message}
      </p>
    );
  }
  return (
    <div className="-mt-4 flex flex-col gap-1.5 text-[13.5px] leading-snug">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-danger">Something Elytra writes in the background didn&rsquo;t finish.</span>
        <button onClick={() => setDetails((v) => !v)} className="text-fg-dim underline underline-offset-2">
          {details ? "Hide details" : "Details"}
        </button>
        <button onClick={onRetry} disabled={busy} className="text-fg-dim underline underline-offset-2">
          Try again
        </button>
      </div>
      {details && <p className="selectable text-[12.5px] text-fg-faint">{jobsError}</p>}
    </div>
  );
}

/**
 * People and themes are about your life now. Whatever hasn't come up for a
 * month (STALE_AFTER_DAYS) leaves the list; one quiet line says how many, and
 * opens them if you want to look. The journal keeps every mention either way.
 */
function CurrentAndEarlier({
  items,
  today,
  empty,
  render,
  onOpenEarlier,
}: {
  items: KeyedSeries[];
  today: string;
  empty: string;
  render: (items: KeyedSeries[]) => ReactNode;
  onOpenEarlier: (item: KeyedSeries) => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const current = items.filter((i) => isCurrent(i.lastSeen, today));
  const earlier = items.filter((i) => !isCurrent(i.lastSeen, today));
  return (
    <div className="flex flex-col gap-3">
      {current.length > 0 ? render(current) : <p className="hint">{empty}</p>}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowEarlier((v) => !v)}
            aria-expanded={showEarlier}
            className="self-start text-[13px] text-fg-faint underline-offset-2 hover:underline"
          >
            {showEarlier ? "Hide" : `${earlier.length} not mentioned in the last month`}
          </button>
          {showEarlier && (
            <div className="flex flex-wrap gap-1.5">
              {earlier.map((i) => (
                <button key={i.key} onClick={() => onOpenEarlier(i)} className="btn-chip text-fg-faint">
                  {i.key}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
