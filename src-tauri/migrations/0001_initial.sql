-- Ember initial schema

-- One evening conversation (created before captures so captures can reference it)
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,           -- the day it covers, YYYY-MM-DD
  started_at TEXT, ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'open'  -- open | wrapped | skipped
);

-- Raw breadcrumbs dropped during the day
CREATE TABLE captures (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,            -- ISO 8601 local
  text TEXT NOT NULL,
  mood_emoji TEXT,                     -- optional, one of 5
  session_id INTEGER REFERENCES sessions(id)  -- set once consumed by a session
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,                  -- user | assistant
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The AI-written journal
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  date TEXT NOT NULL UNIQUE,
  narrative TEXT NOT NULL,             -- "The Day"
  highlights TEXT NOT NULL,            -- JSON array of bullets
  counselor_note TEXT NOT NULL,
  user_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Structured extraction from each day (fuels Insights)
CREATE TABLE day_metrics (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  mood INTEGER, energy INTEGER,        -- 1..10, nullable if unclear
  summary_line TEXT,                   -- one sentence, used in chart tooltips
  raw_json TEXT NOT NULL               -- full extractor output for reprocessing
);

-- Long-term memory: one row per observed fact/pattern/habit/person
CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                  -- theme | habit | person | strength | struggle | fact
  key TEXT NOT NULL,                   -- canonical name, e.g. "gym", "vendor conflict", "Priya"
  detail TEXT,                         -- latest one-line context
  sentiment REAL,                      -- -1..1 rolling average
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,   -- user promoted to tracked habit
  UNIQUE(kind, key)
);

-- Compact rolling self-portrait, rewritten weekly (see §5.3)
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  summary TEXT NOT NULL,               -- <=400 words
  updated_at TEXT NOT NULL
);

CREATE TABLE weekly_reviews (
  id INTEGER PRIMARY KEY,
  week_start TEXT NOT NULL UNIQUE,     -- Monday YYYY-MM-DD
  letter TEXT NOT NULL,                -- the "week in review"
  strengths TEXT NOT NULL,             -- JSON: [{claim, evidence}]
  focus_areas TEXT NOT NULL,           -- JSON: [{claim, evidence}]
  created_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys used: provider, model, api_base, reminder_time, hotkey, voice(1st/2nd person),
-- user_name, chat_length_preference, theme
