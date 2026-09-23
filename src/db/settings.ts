import { getDb } from "./client";
import type { SettingKey } from "./types";

export const SETTINGS_DEFAULTS: Record<SettingKey, string> = {
  provider: "cloud",
  model: "qwen/qwen3.6-27b",
  api_base: "http://localhost:11434/v1/chat/completions",
  api_key: "",
  cloud_api_base: "https://api.groq.com/openai/v1/chat/completions",
  cloud_api_key: "",
  openai_api_key: "",
  cloud_max_tokens: "",
  reminder_time: "21:30",
  hotkey: "CommandOrControl+Shift+J",
  voice: "second",
  user_name: "",
  chat_length_preference: "standard",
  conversation_tone: "balanced",
  conversation_approach: "coach",
  theme: "dark",
  onboarded: "",
  reminder_snoozed_until: "",
  reminder_skip_date: "",
  reminder_last_fired: "",
  hidden_modules: "",
  journal_paper: "cream",
  backup_copy: "1",
  backup_last_at: "",
  streak_cheered: "0",
  install_id: "",
  jobs_last_error: "",
  assessments_enabled: "who5",
  assessments_snoozed_until: "",
  update_source: "",
  update_auto_check: "1",
  update_checked_at: "",
  update_dismissed_version: "",
  last_seen_version: "",
  claude_cli_path: "",
  local_server: "ollama",
  ollama_host: "http://localhost:11434",
  local_num_ctx: "8192",
  lan_enabled: "",
  usual_lunch: "13:00",
  usual_break: "17:30",
  usual_dinner: "20:30",
  day_reminders: "1",
  writing_style_sample: "",
  insight_patterns: "",
  context_mode: "auto",
  codex_cli_path: "",
};

export async function getSetting(key: SettingKey): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? SETTINGS_DEFAULTS[key];
}

export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings",
  );
  const result = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    if (row.key in result) {
      (result as Record<string, string>)[row.key] = row.value;
    }
  }
  return result;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
