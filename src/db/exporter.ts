import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getDb } from "./client";
import { recordLocalReset } from "./sync";
import type {
  Assessment,
  Capture,
  CheckIn,
  DayMetrics,
  Entry,
  HabitPref,
  MemorySummary,
  MonthlyReport,
  Observation,
  Session,
  UserDocument,
  WeeklyReview,
} from "./types";

interface ExportPayload {
  exported_at: string;
  entries: Entry[];
  captures: Capture[];
  sessions: Session[];
  messages: { session_id: number; role: string; content: string; created_at: string }[];
  day_metrics: DayMetrics[];
  observations: Observation[];
  weekly_reviews: WeeklyReview[];
  profile: string | null;
  documents: UserDocument[];
  checkins: CheckIn[];
  habit_prefs: HabitPref[];
  monthly_reports: MonthlyReport[];
  assessments: Assessment[];
  memory_summaries: MemorySummary[];
}

function entryToMarkdown(e: Entry): string {
  const highlights = (() => {
    try {
      const list = JSON.parse(e.highlights || "[]") as string[];
      return list.map((h) => `- ${h}`).join("\n");
    } catch {
      return "";
    }
  })();
  return [
    `## ${e.date} — ${e.title}`,
    "",
    e.narrative,
    "",
    highlights ? `**What stood out**\n${highlights}\n` : "",
    e.counselor_note ? `> *Counselor's note:* ${e.counselor_note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Export everything: a readable Markdown journal and the full JSON. A "save
 * as" window asks where each file goes. Returns the names of the files saved;
 * one cancelled is skipped. */
export async function exportEverything(): Promise<string[]> {
  const db = await getDb();
  const [
    entries,
    captures,
    sessions,
    messages,
    dayMetrics,
    observations,
    reviews,
    profileRows,
    documents,
    checkins,
    habitPrefs,
    monthlyReports,
    assessments,
    memorySummaries,
  ] = await Promise.all([
      db.select<Entry[]>("SELECT * FROM entries ORDER BY date ASC"),
      db.select<Capture[]>("SELECT * FROM captures ORDER BY created_at ASC"),
      db.select<Session[]>("SELECT * FROM sessions ORDER BY date ASC"),
      db.select<ExportPayload["messages"]>(
        "SELECT session_id, role, content, created_at FROM messages ORDER BY id ASC",
      ),
      db.select<DayMetrics[]>("SELECT * FROM day_metrics ORDER BY date ASC"),
      db.select<Observation[]>("SELECT * FROM observations ORDER BY kind, key"),
      db.select<WeeklyReview[]>("SELECT * FROM weekly_reviews ORDER BY week_start ASC"),
      db.select<{ summary: string }[]>("SELECT summary FROM profile WHERE id = 1"),
      db.select<UserDocument[]>("SELECT * FROM documents ORDER BY id ASC"),
      db.select<CheckIn[]>("SELECT * FROM checkins ORDER BY date ASC"),
      db.select<HabitPref[]>("SELECT * FROM habit_prefs ORDER BY key ASC"),
      db.select<MonthlyReport[]>("SELECT * FROM monthly_reports ORDER BY month ASC"),
      db.select<Assessment[]>("SELECT * FROM assessments ORDER BY date ASC"),
      db.select<MemorySummary[]>("SELECT * FROM memory_summaries ORDER BY number ASC"),
    ]);

  const payload: ExportPayload = {
    exported_at: new Date().toString(),
    entries,
    captures,
    sessions,
    messages,
    day_metrics: dayMetrics,
    observations,
    weekly_reviews: reviews,
    profile: profileRows[0]?.summary ?? null,
    documents,
    checkins,
    habit_prefs: habitPrefs,
    monthly_reports: monthlyReports,
    assessments,
    memory_summaries: memorySummaries,
  };

  const markdown = [
    "# Elytra journal export",
    "",
    ...entries.map(entryToMarkdown),
  ].join("\n\n");

  const stamp = localDateStamp();
  const saved: string[] = [];
  for (const file of [
    { name: `elytra-journal-${stamp}.md`, label: "Markdown", ext: "md", text: markdown },
    { name: `elytra-export-${stamp}.json`, label: "JSON", ext: "json", text: JSON.stringify(payload, null, 2) },
  ]) {
    const target = await save({ defaultPath: file.name, filters: [{ name: file.label, extensions: [file.ext] }] });
    if (!target) continue;
    await writeTextFile(target, file.text);
    saved.push(file.name);
  }
  return saved;
}

function localDateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Delete everything: wipes every table. The API keys and pairings are
 * cleared separately by the caller (they live in the keychain, not here). */
export async function deleteEverything(): Promise<void> {
  const db = await getDb();
  // children before parents (messages/captures/entries reference sessions)
  for (const table of [
    "messages",
    "captures",
    "entries",
    "day_metrics",
    "observations",
    "weekly_reviews",
    "monthly_reports",
    "assessments",
    "memory_summaries",
    "profile",
    "documents",
    "checkins",
    "habit_prefs",
    "session_agendas",
    "topics",
    "memory_files",
    "sessions",
    "reminders",
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  // Everything but the computer's phone sync switch, so pairing keeps working.
  await db.execute("DELETE FROM settings WHERE key <> 'lan_enabled'");
  // A paired device resets too at its next sync (db/sync.ts).
  await recordLocalReset();
  // DELETE only marks pages free — the journal text would still sit inside
  // ember.db until overwritten. VACUUM rewrites the file so "delete
  // everything" actually erases.
  await db.execute("VACUUM");
}
