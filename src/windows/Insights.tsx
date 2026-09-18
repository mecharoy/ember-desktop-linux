import { useEffect, useMemo, useState } from "react";
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
  parseDayRows,
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
  if (jobs.fortnightly?.ok) parts.push("Updated Ember's memory summary.");
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
  const [patternsState, setPatternsState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const [data, setData] = useState<Loaded | null>(null);
  const [refreshState, setRefreshState] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });
  const [confirmReanalyse, setConfirmReanalyse] = useState(false);
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
  const dismissed = useMemo(
    () => new Set((data?.habitPrefs ?? []).filter((p) => p.dismissed === 1).map((p) => p.key)),
    [data],
  );

  if (!data) {
    return <p className="px-5 pt-6 text-[14px] text-ink-faint">Loading&hellip;</p>;
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

  return (
    <div className="flex flex-col gap-9 px-5 pb-16 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="page-subtitle">The patterns your days leave behind.</p>
        </div>
        <div className="flex w-full flex-col items-start gap-1.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setConfirmReanalyse(true)}
              disabled={refreshState.busy || n === 0}
              className="btn-ghost"
              title="Read every entry again with the current analysis"
            >
              Re-read all
            </button>
            <button
              onClick={() => runRepair("missing")}
              disabled={refreshState.busy}
              className="btn-subtle shrink-0"
              title="Reload, re-read any entry that couldn't be read, and write any review that's due"
            >
              {refreshState.busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {confirmReanalyse && (
            <div className="fade-up flex flex-wrap items-center gap-2 text-[13.5px] text-ink-soft">
              <span>
                Re-read all {plural(n)}? That&rsquo;s up to {n * 2} AI calls. Your entries stay as they are; only what
                Ember took from them is redone.
              </span>
              <button onClick={() => runRepair("all")} className="btn-subtle shrink-0">
                Re-read
              </button>
              <button onClick={() => setConfirmReanalyse(false)} className="btn-ghost shrink-0">
                Cancel
              </button>
            </div>
          )}
          {refreshState.message ? (
            <span className="text-[13px] leading-snug text-ink-faint" aria-live="polite">
              {refreshState.message}
            </span>
          ) : (
            data.jobsError && (
              <span className="text-[13px] leading-snug text-danger">
                Ember couldn&rsquo;t write something in the background ({data.jobsError}). Refresh to try again.
              </span>
            )
          )}
        </div>
      </div>

      {/* A. vitals — always visible */}
      <VitalsRow vitals={vitals} streak={data.streak} />

      {/* B. mood & energy */}
      {data.hidden.has("mood") ? null : unlocks.moodChart ? (
        <MoodEnergyChart rows={rows} todayKey={today} entryDates={entryDateSet} onOpenEntry={openEntry} />
      ) : (
        <LockedModule
          title="Mood & energy over time"
          teaser="Where your weeks are really heading."
          have={n}
          need={5}
        />
      )}

      {/* C. week rhythm */}
      {data.hidden.has("rhythm") ? null : unlocks.weekRhythm ? (
        <WeekRhythm rows={rows} captureTimes={data.captureTimes} />
      ) : (
        <LockedModule
          title="Week rhythm"
          teaser="Sunday dips, midweek slumps, and the hour your thoughts come out."
          have={n}
          need={14}
        />
      )}

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        {/* D. themes */}
        {data.hidden.has("themes") ? null : unlocks.themes ? (
          <ModuleCard title="Themes">
            <KeyedRows
              items={themes.slice(0, 10)}
              showTrend
              onOpen={(t) => onOpenJournal({ label: `theme: ${t.key}`, dates: t.dates })}
              onExpand={(t) => setExpanded({ group: "themes", item: t })}
            />
          </ModuleCard>
        ) : (
          <LockedModule
            title="Themes"
            teaser="What keeps coming back, and what's fading."
            have={n}
            need={10}
          />
        )}

        {/* H. people (hideable by design) */}
        {data.hidden.has("people") ? null : unlocks.people ? (
          <ModuleCard title="People">
            <KeyedRows
              items={people.slice(0, 10)}
              showTrend={false}
              onOpen={(p) => onOpenJournal({ label: `person: ${p.key}`, dates: p.dates })}
              onExpand={(p) => setExpanded({ group: "people", item: p })}
            />
          </ModuleCard>
        ) : (
          <LockedModule
            title="People"
            teaser="Who fills your days."
            have={n}
            need={10}
          />
        )}
      </div>

      {/* E. habits — the pin UI must be reachable, so the module shows once
          any habit has been discovered (or dismissed, so it can be restored) */}
      {data.hidden.has("habits") ? null : anyPinned || anyDiscovered ? (
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
        />
      ) : (
        <LockedModule
          title="Habits"
          teaser="The gym, the late-night scroll: whatever you keep doing shows up here."
        />
      )}

      {/* F. what moves your mood */}
      {data.hidden.has("movers") ? null : unlocks.moodMovers ? (
        <MoodMovers
          rows={rows}
          dismissedHabits={dismissed}
          onOpen={(f) => onOpenJournal({ label: "mood pattern", dates: f.dates })}
        />
      ) : (
        <LockedModule
          title="What moves your mood"
          teaser="What your better days have in common."
          have={n}
          need={30}
        />
      )}

      {/* G. emotional vocabulary */}
      {data.hidden.has("emotions") ? null : unlocks.emotions ? (
        <EmotionVocab rows={rows} todayKey={today} />
      ) : (
        <LockedModule
          title="Emotional vocabulary"
          teaser="Most people name three feelings. You probably have more."
          have={n}
          need={20}
        />
      )}

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

      {/* K. wellbeing questionnaires — always reachable, so they can be taken or turned on */}
      {!data.hidden.has("wellbeing") && (
        <WellbeingModule
          assessments={data.assessments}
          enabled={data.enabledInstruments}
          todayKey={today}
          onChanged={refresh}
        />
      )}

      {/* L. sleep */}
      {data.hidden.has("sleep") ? null : timedNights >= SLEEP_MIN_NIGHTS ? (
        <SleepModule
          diary={data.checkins}
          rows={rows}
          todayKey={today}
          onOpen={(f) => openDates("sleep", f.dates)}
        />
      ) : (
        <LockedModule
          title="Sleep"
          teaser="How steady your nights are. Counts nights with a bedtime and wake time."
          have={timedNights}
          need={SLEEP_MIN_NIGHTS}
        />
      )}

      {/* O. daily routine */}
      {data.hidden.has("routine") ? null : routineOpen ? (
        <RoutineModule rows={rows} diary={data.checkins} todayKey={today} onOpen={openDates} />
      ) : (
        <LockedModule
          title="Daily routine"
          teaser="How well your days keep their rhythm."
        />
      )}

      {/* M. activities & mood */}
      {data.hidden.has("activities") ? null : n >= 10 && anyActivities ? (
        <ActivitiesModule rows={rows} todayKey={today} onOpen={openDates} />
      ) : (
        <LockedModule
          title="Activities & mood"
          teaser="What actually lifts you."
          have={n}
          need={10}
        />
      )}

      {/* N. thinking patterns */}
      {data.hidden.has("thinking") ? null : n >= 10 ? (
        <ThinkingModule rows={rows} todayKey={today} onOpen={openDates} />
      ) : (
        <LockedModule
          title="Thinking patterns"
          teaser="The stories your mind tells on repeat, in your own words."
          have={n}
          need={10}
        />
      )}

      {/* I + J. weekly review cards, letters, monthly reports and memory summaries */}
      {!data.hidden.has("reviews") && (
        <ReviewsModule
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
      )}

      {/* P. suggestions, built on what goes together in their days */}
      {!data.hidden.has("suggestions") && (
        <SuggestionsModule
          patterns={data.patterns}
          state={patternsState}
          trackedHabits={new Set(data.habitObservations.filter((o) => o.pinned === 1).map((o) => o.key.trim().toLowerCase()))}
          onFind={handleFindPatterns}
          onTrack={handleTrackSuggestion}
        />
      )}
    </div>
  );
}
