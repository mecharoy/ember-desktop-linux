import { listUnjournaledCaptures } from "../db/captures";
import { localDateKey } from "../time";
import { getSetting } from "../db/settings";
import { latestEntryDateBefore } from "../db/entries";
import { getDayMetrics, listRecentDayMetrics } from "../db/metrics";
import { listObservations, listTopObservations } from "../db/observations";
import { getProfileSummary } from "../db/profile";
import { listEnabledDocuments } from "../db/documents";
import { formatDocumentsForPrompt } from "./documents";
import { getCheckIn } from "../db/checkins";
import { latestWeeklyReview } from "../db/reviews";
import { listEntries } from "../db/entries";
import { listMemorySummaries } from "../db/memorySummaries";
import { formatJournalsSince, formatSummaryForPrompt } from "./fortnightly";
import { formatCheckInForPrompt, formatDayParts, toCheckInSummary } from "./checkin";
import { parseStyle } from "./prompts/style";
import type { WeeklyReview } from "../db/types";
import { listTopics } from "../db/topics";
import { getAgenda } from "../db/agendas";
import { formatTopicsForPrompt } from "./topics";
import { formatAgendaForPreamble } from "./agenda";
import {
  counselorSystemPrompt,
  counselorTurnPreamble,
  EMPTY_MEMORY_SUMMARY,
  EMPTY_PROFILE_SUMMARY,
  type CounselorPromptLayers,
  type LengthPreference,
} from "./prompts/counselor";
import { addDays, daysBetween } from "../insights/stats";
import {
  computeNeglectedDomains,
  formatOpenThreads,
  formatTopObservations,
  selectOpenThreads,
} from "./memory";
import { formatCaptureDaysForPrompt } from "../captureDays";
import { contextBudget, conversationShares, type ContextBudget } from "./budget";
import { estimateTokens } from "./tokens";
import { clip, pickRelevant } from "./relevance";
import { formatMemoryFiles, memoryPool } from "./memoryFiles";
import { listMemoryFiles } from "../db/memoryFiles";
import { getConversationPrep } from "../db/agendas";
import { counselorCompactPrompt, type CompactPromptLayers } from "./prompts/counselorCompact";

export { EMPTY_PROFILE_SUMMARY };

/** "Thursday, 2026-07-09" — the model has no clock of its own. */
export function formatTodayLine(dateKey: string): string {
  const weekday = new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}, ${dateKey}`;
}

/** "HH:MM" local — the reminder marker needs a reference clock. */
function nowTimeLine(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The week's letter opens the next evening's chat. It's handed over
 * only while it's news — written after their last journal entry and within
 * the past week — so it isn't brought up night after night.
 */
export function letterForTonight(
  review: Pick<WeeklyReview, "letter" | "created_at"> | null,
  lastEntryDate: string | null,
  todayKey: string,
): string {
  if (!review) return "(none)";
  const written = review.created_at.slice(0, 10);
  if (lastEntryDate && written <= lastEntryDate) return "(none)";
  if (daysBetween(written, todayKey) > 7) return "(none)";
  return review.letter.trim() || "(none)";
}

/**
 * The per-turn state that used to live in the system prompt — the clock and
 * the exchange counter — carried on the user turn instead. Anything in here
 * changes between turns by definition, and anything that changes between
 * turns invalidates the cached prefix, so it must stay out of the system
 * prompt. See prompts/counselor.ts for the full reasoning.
 */
export async function buildCounselorTurnPreamble(
  opts: { exchangeCount?: number; date?: string } = {},
): Promise<string> {
  const [lengthSetting, approach, agenda] = await Promise.all([
    getSetting("chat_length_preference"),
    getSetting("conversation_approach"),
    opts.date ? getAgenda(opts.date) : Promise.resolve(null),
  ]);
  return counselorTurnPreamble({
    nowTime: nowTimeLine(),
    exchangeCount: opts.exchangeCount ?? 0,
    lengthPreference: parseLength(lengthSetting),
    // Friend mode has no checklist, even one left from switching style mid-day.
    agenda: agenda && agenda.length > 0 && approach !== "friend" ? formatAgendaForPreamble(agenda) : undefined,
  });
}

export function parseLength(value: string): LengthPreference {
  return value === "quick" || value === "long" ? value : "standard";
}

/**
 * Assembles the counselor system prompt from the three
 * compact memory layers: profile summary, top observations, and
 * today + yesterday — never the raw history — plus the user's enabled
 * reference documents and the session-stable state (date, days since the
 * last entry). Every layer is empty-safe, so a
 * brand-new install degrades gracefully.
 *
 * Deliberately stable for the whole session: the caller builds this once and
 * reuses the exact string every turn, which is what makes the prefix a cache
 * read rather than a re-write. Volatile state goes in
 * buildCounselorTurnPreamble() instead.
 *
 * `dayKey` is the day being talked about: today, or an earlier day picked
 * from the Journal calendar, in which case the prompt says so (lookingBack).
 */
export async function buildCounselorSystemPrompt(dayKey: string = localDateKey()): Promise<string> {
  const budget = await contextBudget();
  if (budget.mode === "compact") return counselorCompactPrompt(await gatherCompactLayers(dayKey, budget));
  return counselorSystemPrompt(await gatherCounselorLayers(dayKey));
}

/**
 * Today's own material, for small models: the check-in, the day in parts,
 * today's notes (cut to fit), a fresh weekly letter and the gap since the last
 * entry. `query` is the text memory lines are matched against.
 */
export async function gatherTodayMaterial(
  dayKey: string,
  budget: ContextBudget,
): Promise<{ text: string; query: string; checkIn: string; dayParts: string; notes: string }> {
  const realToday = localDateKey();
  const [captures, checkInRow, latestReview, lastEntryDate, agendaPrep] = await Promise.all([
    listUnjournaledCaptures(dayKey),
    getCheckIn(dayKey),
    latestWeeklyReview(),
    latestEntryDateBefore(dayKey),
    getConversationPrep(dayKey),
  ]);
  const checkInSummary = toCheckInSummary(checkInRow);
  const checkIn = formatCheckInForPrompt(checkInSummary);
  const dayParts = formatDayParts(checkInSummary, { lookingBack: dayKey < realToday });
  const notes = clip(formatCaptureDaysForPrompt(captures, dayKey), Math.floor(budget.totalTokens * 0.12));
  const letter = dayKey === realToday ? letterForTonight(latestReview, lastEntryDate, dayKey) : "(none)";
  const gap = lastEntryDate ? daysBetween(lastEntryDate, dayKey) : null;
  const text = `THE DAY: ${formatTodayLine(dayKey)}${gap && gap > 1 ? ` (${gap} days since their last entry)` : ""}

THEIR CHECK-IN:
${checkIn}

THE DAY IN PARTS:
${dayParts}

TODAY'S NOTES:
${notes}${letter !== "(none)" ? `\n\nTHIS WEEK'S LETTER FROM EMBER (mention it once):\n${clip(letter, 200)}` : ""}`;
  const agendaText = (agendaPrep?.items ?? []).map((i) => i.text).join("\n");
  return { text, query: [captures.map((c) => c.text).join("\n"), checkIn, agendaText].join("\n"), checkIn, dayParts, notes };
}

/** The layers of the compact prompt: the briefing from the preparation step
 *  and the memory lines that match today, within the budget. */
export async function gatherCompactLayers(dayKey: string, budget: ContextBudget): Promise<CompactPromptLayers> {
  const realToday = localDateKey();
  const [userNameSetting, toneSetting, approachSetting, prep, today] = await Promise.all([
    getSetting("user_name"),
    getSetting("conversation_tone"),
    getSetting("conversation_approach"),
    getConversationPrep(dayKey),
    gatherTodayMaterial(dayKey, budget),
  ]);
  const base: CompactPromptLayers = {
    userName: userNameSetting.trim(),
    todayLine: formatTodayLine(dayKey),
    lookingBack:
      dayKey < realToday ? { realTodayLine: formatTodayLine(realToday), daysAgo: daysBetween(dayKey, realToday) } : undefined,
    style: parseStyle(toneSetting, approachSetting),
    briefing: prep?.briefing ?? "(none)",
    checkIn: today.checkIn,
    dayParts: today.dayParts,
    notes: today.notes,
    memory: "",
  };
  // Whatever the prompt doesn't use yet goes to memory lines.
  const withoutMemory = estimateTokens(counselorCompactPrompt(base));
  const shares = conversationShares(budget, withoutMemory);
  const memoryTokens = Math.max(150, Math.min(shares.context, 900));
  return { ...base, memory: pickRelevant(await memoryPool(dayKey), today.query, memoryTokens) };
}

/** Everything the counselor prompt is built from; also what the checklist
 *  (ai/agenda.ts) is made from. */
export async function gatherCounselorLayers(dayKey: string = localDateKey()): Promise<CounselorPromptLayers> {
  const today = dayKey;
  const realToday = localDateKey();
  const [
    userNameSetting,
    toneSetting,
    approachSetting,
    pendingCaptures,
    profile,
    topObservations,
    yesterdayMetrics,
    recentMetrics,
    allObservations,
    lastEntryDate,
    documents,
    checkInRow,
    latestReview,
    entries,
    summaries,
    topics,
    memoryFiles,
  ] = await Promise.all([
    getSetting("user_name"),
    getSetting("conversation_tone"),
    getSetting("conversation_approach"),
    listUnjournaledCaptures(today),
    getProfileSummary(),
    listTopObservations(today, 15),
    getDayMetrics(addDays(today, -1)),
    listRecentDayMetrics(5),
    listObservations(),
    latestEntryDateBefore(today),
    listEnabledDocuments(),
    getCheckIn(today),
    latestWeeklyReview(),
    listEntries(),
    listMemorySummaries(),
    listTopics(),
    listMemoryFiles(),
  ]);

  // Summary n-1 plus every entry since. For a past day, only the
  // summaries and entries that existed before it make sense, so a summary
  // that folded in later days is skipped in favour of an earlier one.
  const summariesBefore = summaries.filter((s) => s.period_end < today);
  const latestSummary = summariesBefore[summariesBefore.length - 1];

  const neglected = computeNeglectedDomains(recentMetrics);
  const openThreads = selectOpenThreads(allObservations, today);
  const checkIn = toCheckInSummary(checkInRow);

  return {
    userName: userNameSetting.trim(),
    todayLine: formatTodayLine(today),
    profileSummary: profile?.trim() || EMPTY_PROFILE_SUMMARY,
    memorySummary: latestSummary ? formatSummaryForPrompt(latestSummary) : EMPTY_MEMORY_SUMMARY,
    recentJournals: formatJournalsSince(entries, summariesBefore, today),
    checkIn: formatCheckInForPrompt(checkIn),
    dayParts: formatDayParts(checkIn, { lookingBack: today < realToday }),
    style: parseStyle(toneSetting, approachSetting),
    // The week's letter opens a real evening, not a look back at an old one.
    weeklyLetter: today === realToday ? letterForTonight(latestReview, lastEntryDate, today) : "(none)",
    topObservations: formatTopObservations(topObservations),
    yesterdaySummaryLine: yesterdayMetrics?.summary_line ?? "(no entry from yesterday)",
    pendingCaptures: formatCaptureDaysForPrompt(pendingCaptures, today),
    neglectedDomains: neglected.length > 0 ? neglected.join("; ") : "(nothing stands out)",
    openThreads: formatOpenThreads(openThreads),
    documents: formatDocumentsForPrompt(documents),
    daysSinceLastEntry: lastEntryDate ? daysBetween(lastEntryDate, today) : null,
    lookingBack:
      today < realToday
        ? { realTodayLine: formatTodayLine(realToday), daysAgo: daysBetween(today, realToday) }
        : undefined,
    topics: formatTopicsForPrompt(topics),
    memoryFiles: formatMemoryFiles(memoryFiles),
  };
}
