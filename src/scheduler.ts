// Scheduler, desktop edition: a light timer in the main window (which lives
// in the tray, so it keeps running) rings the evening reminder and task
// reminders, marks missed days as skipped and runs the review jobs.

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { countUnjournaledCaptures } from "./db/captures";
import { localDateKey } from "./time";
import { getEntryForDate } from "./db/entries";
import { listDueReminders, markReminderFired } from "./db/reminders";
import { getSessionForDate, markMissedDaysSkipped } from "./db/sessions";
import { getSetting, setSetting } from "./db/settings";
import { runReviewJobsAndNotify } from "./ai/reviewJobs";
import { addDays } from "./insights/stats";

const CHECK_MS = 30_000;

/** Days planEveningReminders looks ahead (the phone hands these to Android;
 *  here it only feeds the tests the two editions share). */
const EVENING_DAYS = 7;

// ---------- pure decision logic (unit-tested) ----------

export interface ReminderState {
  now: string; // "YYYY-MM-DDTHH:MM" local
  reminderTime: string; // "HH:MM"
  entrySavedToday: boolean;
  sessionWrapped: boolean;
  snoozedUntil: string; // "YYYY-MM-DDTHH:MM" or ""
  skipDate: string; // "YYYY-MM-DD" or ""
  lastFired: string; // "YYYY-MM-DDTHH:MM" or ""
}

/**
 * Fire at most once per arming: once when the reminder time passes, and once
 * more after each snooze elapses. Never after the entry is saved, the session
 * wrapped, or tonight was skipped. (Same-format ISO-local strings compare
 * correctly as plain strings.)
 */
export function shouldFireReminder(s: ReminderState): boolean {
  const today = s.now.slice(0, 10);
  if (s.entrySavedToday || s.sessionWrapped) return false;
  if (s.skipDate === today) return false;
  if (s.now.slice(11, 16) < s.reminderTime) return false;
  if (s.snoozedUntil && s.now < s.snoozedUntil) return false;

  const firedToday = s.lastFired.slice(0, 10) === today;
  if (!firedToday) return true;
  // already fired today — only a snooze that has since elapsed re-arms it
  return Boolean(s.snoozedUntil && s.lastFired < s.snoozedUntil && s.now >= s.snoozedUntil);
}

/** The Today-tab banner shows whenever the evening slot is open (independent
 * of whether the one-shot notification already fired), but respects snooze/skip. */
export function shouldShowReminderBanner(s: Omit<ReminderState, "lastFired">): boolean {
  const today = s.now.slice(0, 10);
  if (s.entrySavedToday || s.sessionWrapped) return false;
  if (s.skipDate === today) return false;
  if (s.now.slice(11, 16) < s.reminderTime) return false;
  if (s.snoozedUntil && s.now < s.snoozedUntil) return false;
  return true;
}

/**
 * When the evening reminder should ring over the next `days` days, as
 * "YYYY-MM-DDTHH:MM" local times, soonest first. Tonight is left out once the
 * entry is saved, the conversation wrapped or tonight skipped, and a snooze
 * moves tonight's ring later. Times already past are left out: the app is
 * open at that moment, and the Today banner is the reminder.
 */
export function planEveningReminders(s: Omit<ReminderState, "lastFired">, days = EVENING_DAYS): string[] {
  const today = s.now.slice(0, 10);
  const times: string[] = [];
  for (let i = 0; i < days; i++) {
    let at = `${addDays(today, i)}T${s.reminderTime}`;
    if (i === 0) {
      if (s.entrySavedToday || s.sessionWrapped || s.skipDate === today) continue;
      if (s.snoozedUntil && s.snoozedUntil > at) at = s.snoozedUntil;
    }
    if (at <= s.now) continue;
    times.push(at);
  }
  return times;
}

export function nowLocalMinute(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- runtime ----------

async function readReminderState(): Promise<ReminderState> {
  const today = localDateKey();
  const [reminderTime, snoozedUntil, skipDate, lastFired, entry, session] = await Promise.all([
    getSetting("reminder_time"),
    getSetting("reminder_snoozed_until"),
    getSetting("reminder_skip_date"),
    getSetting("reminder_last_fired"),
    getEntryForDate(today),
    getSessionForDate(today),
  ]);
  return {
    now: nowLocalMinute(),
    reminderTime: reminderTime || "21:30",
    entrySavedToday: entry !== null,
    sessionWrapped: session?.status === "wrapped",
    snoozedUntil,
    skipDate,
    lastFired,
  };
}

/** Asks once for permission to show notifications, where the system asks. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    return (await isPermissionGranted()) || (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

async function notify(title: string, body: string): Promise<void> {
  if (!(await ensureNotificationPermission())) return;
  // On Windows a toast that stays until acted on; elsewhere a plain one.
  await invoke("show_reminder_notification", { title, body }).catch(() => {});
}

async function checkReminder(): Promise<void> {
  const state = await readReminderState();
  if (!shouldFireReminder(state)) return;
  await setSetting("reminder_last_fired", state.now);
  // Everything still waiting for an entry, not just today's.
  const count = await countUnjournaledCaptures(localDateKey());
  // Only the count, never what the notes say.
  await notify(
    "Ember",
    count > 0 ? `Ready to talk about today? (${count} note${count === 1 ? "" : "s"} waiting)` : "Ready to talk about today?",
  );
  await emit("reminder:fired");
}

/** Task reminders: each is marked fired before the notification, so a
 *  failure can never turn into a loop. Ones that came due while the computer
 *  was off ring on the next launch. */
async function checkTaskReminders(): Promise<void> {
  const due = await listDueReminders(nowLocalMinute());
  for (const r of due) {
    await markReminderFired(r.id);
    await notify("Ember reminder", r.text);
  }
  if (due.length > 0) await emit("reminders:changed");
}

/** For the Today tab's in-app reminder banner. */
export async function isReminderBannerVisible(): Promise<boolean> {
  const s = await readReminderState();
  return shouldShowReminderBanner(s);
}

export async function snoozeReminder(minutes: number): Promise<void> {
  const until = nowLocalMinute(new Date(Date.now() + minutes * 60_000));
  await setSetting("reminder_snoozed_until", until);
  await emit("reminder:changed");
}

export async function skipTonight(): Promise<void> {
  await setSetting("reminder_skip_date", localDateKey());
  await emit("reminder:changed");
}

let started = false;

/** Idempotent; called once from App mount (main window only). */
export function startScheduler(): void {
  if (started) return;
  started = true;

  markMissedDaysSkipped(localDateKey()).catch(() => {});
  runReviewJobsAndNotify({ whenIdle: true }).catch(() => {});
  checkReminder().catch(() => {});
  checkTaskReminders().catch(() => {});

  let ticks = 0;
  setInterval(() => {
    checkReminder().catch(() => {});
    checkTaskReminders().catch(() => {});
    // The review check reads the database, so only about every 10 minutes.
    if (++ticks % 20 === 0) {
      markMissedDaysSkipped(localDateKey()).catch(() => {});
      runReviewJobsAndNotify({ whenIdle: true }).catch(() => {});
    }
  }, CHECK_MS);
}
