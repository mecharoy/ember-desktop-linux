-- Notes about yourself added in Settings (.md / .txt). Enabled ones are
-- given to the evening conversation. Re-adding a file replaces its text.
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,              -- original file name, e.g. "about-me.md"
  content TEXT NOT NULL,                  -- UTF-8 text, BOM stripped, \n line endings
  enabled INTEGER NOT NULL DEFAULT 1,     -- 1 = loaded into each session
  created_at TEXT NOT NULL,               -- ISO 8601 local
  updated_at TEXT NOT NULL                -- ISO 8601 local
);
