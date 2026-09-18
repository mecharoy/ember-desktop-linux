-- One-time task reminders the counselor can set mid-conversation
-- ("remind me tomorrow at 10 to submit the form").
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  due_at TEXT NOT NULL,                    -- "YYYY-MM-DDTHH:MM" local
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | fired | dismissed
  created_at TEXT NOT NULL                 -- ISO 8601 local
);
CREATE INDEX idx_reminders_status_due ON reminders(status, due_at);
