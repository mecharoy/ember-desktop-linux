-- Questionnaires, memory summaries and related tables.

-- 1. Standard questionnaires, answered by the user item by item. A score is
--    never inferred from journal text: that would make it neither valid nor
--    theirs.
CREATE TABLE assessments (
  id INTEGER PRIMARY KEY,
  instrument TEXT NOT NULL,             -- 'who5' | 'phq9' | 'gad7'
  date TEXT NOT NULL,                   -- YYYY-MM-DD local, the day it was taken
  answers TEXT NOT NULL,                -- JSON array of item scores, in item order
  score INTEGER NOT NULL,               -- raw total: WHO-5 0-25, PHQ-9 0-27, GAD-7 0-21
  difficulty INTEGER,                   -- PHQ-9 only: 0-3 "how difficult"; NULL otherwise
  created_at TEXT NOT NULL,             -- ISO 8601 local
  UNIQUE (instrument, date)
);

-- 2. A sleep diary on the check-in, in the style used for insomnia therapy
--    (CBT-I). All optional; the night is the one before the check-in's date.
ALTER TABLE checkins ADD COLUMN bedtime TEXT;              -- "HH:MM", got into bed
ALTER TABLE checkins ADD COLUMN wake_time TEXT;            -- "HH:MM", got up
ALTER TABLE checkins ADD COLUMN sleep_latency_min INTEGER; -- minutes to fall asleep
ALTER TABLE checkins ADD COLUMN sleep_quality INTEGER;     -- 1..5

-- 3. The monthly report's formulation (the "5 Ps"), as JSON. NULL on reports
--    written before it existed.
ALTER TABLE monthly_reports ADD COLUMN formulation TEXT;

-- 4. Fortnightly memory summaries. Summary n folds summary n-1 and every
--    journal entry no summary has covered yet into one systematic summary;
--    the evening chat reads the latest one plus the entries written since.
CREATE TABLE memory_summaries (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,       -- 1, 2, 3... in the order written
  period_start TEXT NOT NULL,           -- earliest entry date folded in
  period_end TEXT NOT NULL,             -- latest entry date folded in
  summary TEXT NOT NULL,                -- JSON sections (ai/fortnightly.ts)
  source_days TEXT NOT NULL,            -- comma-separated entry dates folded in
  created_at TEXT NOT NULL              -- ISO 8601 local
);
