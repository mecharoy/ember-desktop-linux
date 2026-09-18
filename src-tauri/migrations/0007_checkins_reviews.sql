-- Check-ins, weekly reviews and related tables.

-- 1. The short form filled in before the evening conversation. These are the
--    user's own ratings, trusted over anything the AI infers from text.
CREATE TABLE checkins (
  date TEXT PRIMARY KEY,                -- YYYY-MM-DD local
  mood INTEGER,                         -- 1..10, NULL if left blank
  energy INTEGER,                       -- 1..10
  sleep_hours REAL,                     -- last night
  feeling TEXT,                         -- a word or two, in their own words
  on_mind TEXT,                         -- optional free text
  habits TEXT NOT NULL DEFAULT '{}',    -- JSON {habit key: true | false} for pinned habits
  created_at TEXT NOT NULL,             -- ISO 8601 local
  updated_at TEXT NOT NULL
);

-- 2. Per-habit choices that must survive the observations rebuild (which
--    wipes and re-derives that table after every extraction).
CREATE TABLE habit_prefs (
  key TEXT PRIMARY KEY,                 -- canonical habit key: trimmed, lowercase
  dismissed INTEGER NOT NULL DEFAULT 0, -- 1 = "not a habit", hidden everywhere
  direction TEXT                        -- 'less' = something to do less of; NULL = more
);

-- 3. Which extracted days a weekly review was written from, so it is
--    rewritten when its week gains or changes a day. NULL on older rows.
ALTER TABLE weekly_reviews ADD COLUMN source_days TEXT;

-- 4. The monthly report, written once a month is over.
CREATE TABLE monthly_reports (
  month TEXT PRIMARY KEY,               -- YYYY-MM
  letter TEXT NOT NULL,
  changed TEXT NOT NULL,                -- one thing that changed since last month
  stats TEXT NOT NULL,                  -- JSON of the month's numbers (computed in code)
  source_days TEXT NOT NULL,            -- comma-separated extracted dates it used
  created_at TEXT NOT NULL
);
