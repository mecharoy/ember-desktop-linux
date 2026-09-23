// Typed row shapes mirroring src-tauri/migrations/0001_initial.sql

export interface Capture {
  id: number;
  created_at: string; // ISO 8601 local
  text: string;
  mood_emoji: string | null;
  session_id: number | null;
  external_id: string | null; // phone-generated id for inbox-synced captures
}

export interface Session {
  id: number;
  date: string; // YYYY-MM-DD
  started_at: string | null;
  ended_at: string | null;
  status: "open" | "wrapped" | "skipped";
}

export interface Message {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Entry {
  id: number;
  session_id: number;
  date: string;
  title: string;
  narrative: string;
  highlights: string; // JSON array of strings
  counselor_note: string;
  user_edited: 0 | 1;
  created_at: string;
  paper: string | null; // migration 0009: paper id (components/paper.ts); NULL = Settings default
}

export interface DayMetrics {
  id: number;
  date: string;
  mood: number | null;
  energy: number | null;
  summary_line: string | null;
  raw_json: string;
}

export interface Observation {
  id: number;
  kind: "theme" | "habit" | "person" | "strength" | "struggle" | "fact";
  key: string;
  detail: string | null;
  sentiment: number | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  pinned: 0 | 1;
}

export interface Profile {
  id: 1;
  summary: string;
  updated_at: string;
}

export interface Reminder {
  id: number;
  due_at: string; // "YYYY-MM-DDTHH:MM" local
  text: string;
  status: "pending" | "fired" | "dismissed";
  created_at: string;
}

export interface UserDocument {
  id: number;
  name: string; // original file name, e.g. "about-me.md" — unique
  content: string;
  enabled: 0 | 1; // 1 = loaded into every counselor session
  created_at: string;
  updated_at: string;
}

export interface WeeklyReview {
  id: number;
  week_start: string;
  letter: string;
  strengths: string; // JSON: [{claim, evidence, dates?}]
  focus_areas: string; // JSON: [{claim, evidence, dates?}]
  created_at: string;
  source_days: string | null; // comma-separated dates it was written from; NULL on pre-0007 rows
}

/** The pre-conversation form (migration 0007) — the user's own ratings. */
export interface CheckIn {
  date: string; // YYYY-MM-DD
  mood: number | null;
  energy: number | null;
  sleep_hours: number | null;
  feeling: string | null;
  on_mind: string | null;
  habits: string; // JSON {habit key: boolean}
  created_at: string;
  updated_at: string;
  // sleep diary (migration 0008) — the night before `date`
  bedtime: string | null; // "HH:MM"
  wake_time: string | null; // "HH:MM"
  sleep_latency_min: number | null;
  sleep_quality: number | null; // 1..5
  // where the day splits into parts (migration 0010): "HH:MM" | "not-yet" | "skipped"
  lunch: string | null;
  evening_break: string | null;
  dinner: string | null;
  /** What they did in each stretch of the day (migration 0013): JSON
   *  {"morning" | "afternoon" | "evening" | "night": text}. */
  day_notes: string | null;
}

/** One line of the conversation checklist (migration 0013). */
export interface AgendaItem {
  id: string;
  section: "past" | "today" | "future";
  text: string;
  /** open: still to talk about; done: covered; skip: they don't want to talk about it. */
  state: "open" | "done" | "skip";
  /** The topic it belongs to (topics.key), when there is one. */
  topic?: string | null;
}

export interface SessionAgenda {
  date: string;
  items: string; // JSON AgendaItem[]
  created_at: string;
  updated_at: string;
  /** Migration 0014: the preparation step's briefing (small models). */
  briefing: string | null;
  /** Summary of the chat before message number summary_upto (small models). */
  chat_summary: string | null;
  summary_upto: number;
}

/** Something they are working through, kept across conversations (migration 0013). */
export interface Topic {
  key: string;
  title: string;
  status: "open" | "resolved" | "avoid";
  notes: string;
  next_step: string;
  first_seen: string;
  last_discussed: string | null;
  updated_at: string;
}

export type Instrument = "who5" | "phq9" | "gad7";

export interface Assessment {
  id: number;
  instrument: Instrument;
  date: string; // YYYY-MM-DD
  answers: string; // JSON number[]
  score: number;
  difficulty: number | null; // PHQ-9 only
  created_at: string;
}

export interface MemorySummary {
  id: number;
  number: number;
  period_start: string;
  period_end: string;
  summary: string; // JSON (ai/fortnightly.ts FortnightSummary)
  source_days: string;
  created_at: string;
}

export interface HabitPref {
  key: string; // canonical: trimmed, lowercase
  dismissed: 0 | 1;
  direction: "less" | null;
}

export interface MonthlyReport {
  month: string; // YYYY-MM
  letter: string;
  changed: string;
  stats: string; // JSON MonthStats (src/insights/stats.ts)
  source_days: string;
  created_at: string;
  formulation: string | null; // JSON Formulation (ai/monthly.ts); NULL before migration 0008
}

export type SettingKey =
  | "provider"
  | "model"
  | "api_base"
  | "api_key" // legacy pre-Phase-6 location; migrated to the OS keychain on first read
  | "cloud_api_base" // full chat-completions URL of the chosen free provider
  | "openai_api_key" // keychain fallback only, like cloud_api_key
  | "cloud_api_key" // keychain fallback only (systems with no OS credential store)
  | "cloud_max_tokens" // ceiling on one reply; empty means use the preset's
  | "reminder_time"
  | "hotkey"
  | "voice"
  | "user_name"
  | "chat_length_preference"
  | "conversation_tone" // gentle | balanced | blunt (ai/prompts/style.ts)
  | "conversation_approach" // friend | coach | therapist
  | "theme"
  | "onboarded" // "1" once first-run onboarding completed
  | "reminder_snoozed_until" // ISO local timestamp, empty when not snoozed
  | "reminder_skip_date" // YYYY-MM-DD the user skipped tonight
  | "reminder_last_fired" // YYYY-MM-DD the notification last fired
  | "hidden_modules" // comma-separated Insights module ids
  | "assessments_enabled" // comma-separated instruments the user opted into
  | "assessments_snoozed_until" // YYYY-MM-DD: don't offer a due questionnaire before this day
  | "update_source" // GitHub repository (or latest.json link) updates and feedback go through; empty = built-in default
  | "update_auto_check" // "1" = look for a newer release when Elytra opens
  | "update_checked_at" // ISO timestamp of the last successful look
  | "update_dismissed_version" // a release the user said "later" to; not offered again on launch
  | "last_seen_version" // the version whose "What's new" card was last shown or skipped
  | "journal_paper" // default paper for journal entries (components/paper.ts id)
  | "backup_copy" // "1" = keep a daily copy in Documents/Elytra
  | "backup_last_at" // ISO timestamp of the last copy written
  | "streak_cheered" // the run length the beetle last celebrated, so it hops once per milestone
  | "install_id" // random id of the install this journal belongs to; see src/install.ts
  | "jobs_last_error" // what the last background review run couldn't write, "" if nothing
  | "claude_cli_path" // optional override; empty string means auto-detect
  | "local_server" // "ollama" (default) or "openai" for LM Studio and other OpenAI-style servers
  | "ollama_host" // where Ollama answers, e.g. http://localhost:11434
  | "local_num_ctx" // context size the local model is loaded with
  | "lan_enabled" // "1" = phones on the home network may pair and sync (this computer only)
  | "usual_lunch" // "HH:MM" their usual lunch, asked at setup
  | "usual_break" // "HH:MM" their usual afternoon/evening break
  | "usual_dinner" // "HH:MM" their usual dinner
  | "day_reminders" // "1" = on the phone, a note reminder at those three times
  | "writing_style_sample" // their own writing, so entries sound like them
  | "context_mode" // auto | full | compact: how much Elytra sends the model (ai/budget.ts); this device only
  | "insight_patterns" // JSON: links and suggestions from ai/patterns.ts
  | "codex_cli_path"; // optional override for the codex binary
