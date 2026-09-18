-- Keeps Ember on a computer and Ember on a phone in step over the home network.
--
-- Rows that have no natural name (sessions, notes, messages, reminders) get a
-- random uid, filled in by a trigger so no insert has to know about it.
-- Every change to a row that travels is written to sync_changes: one row per
-- changed row, holding when it last changed, a rising revision number and who
-- it came from. The other device asks for everything past the revision it saw.

ALTER TABLE sessions ADD COLUMN uid TEXT;
UPDATE sessions SET uid = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX idx_sessions_uid ON sessions(uid);

ALTER TABLE captures ADD COLUMN uid TEXT;
UPDATE captures SET uid = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX idx_captures_uid ON captures(uid);

ALTER TABLE messages ADD COLUMN uid TEXT;
UPDATE messages SET uid = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX idx_messages_uid ON messages(uid);

ALTER TABLE reminders ADD COLUMN uid TEXT;
UPDATE reminders SET uid = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX idx_reminders_uid ON reminders(uid);

CREATE TABLE sync_changes (
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,                     -- the row's name on every device
  rev INTEGER NOT NULL,                 -- rises with every change
  changed_at TEXT NOT NULL,             -- UTC, "YYYY-MM-DDTHH:MM:SS.SSSZ"
  deleted INTEGER NOT NULL DEFAULT 0,
  origin TEXT,                          -- device it came from; NULL = made here
  PRIMARY KEY (tbl, pk)
);
CREATE INDEX idx_sync_changes_rev ON sync_changes(rev);

-- Paired devices and how far each direction has got.
CREATE TABLE sync_peers (
  peer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  sent_rev INTEGER NOT NULL DEFAULT 0,      -- our changes up to here reached them
  received_rev INTEGER NOT NULL DEFAULT 0,  -- their changes up to here reached us
  last_sync_at TEXT
);

INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'sessions', CAST(uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(ended_at, started_at)), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM sessions;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'captures', CAST(uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM captures;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'messages', CAST(uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM messages;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'entries', CAST(date AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM entries;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'day_metrics', CAST(date AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', date), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM day_metrics;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'observations', CAST(kind AS TEXT) || char(31) || CAST(key AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', last_seen), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM observations;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'profile', CAST(id AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM profile;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'weekly_reviews', CAST(week_start AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM weekly_reviews;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'monthly_reports', CAST(month AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM monthly_reports;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'memory_summaries', CAST(number AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM memory_summaries;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'reminders', CAST(uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM reminders;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'documents', CAST(name AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM documents;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'checkins', CAST(date AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM checkins;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'habit_prefs', CAST(key AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), '1970-01-01T00:00:00.000Z', 0, NULL
  FROM habit_prefs;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'assessments', CAST(instrument AS TEXT) || char(31) || CAST(date AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '1970-01-01T00:00:00.000Z'), 0, NULL
  FROM assessments;
INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'settings', CAST(key AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), '1970-01-01T00:00:00.000Z', 0, NULL
  FROM settings WHERE key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until');

CREATE TRIGGER uid_sessions AFTER INSERT ON sessions WHEN NEW.uid IS NULL BEGIN
  UPDATE sessions SET uid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER uid_captures AFTER INSERT ON captures WHEN NEW.uid IS NULL BEGIN
  UPDATE captures SET uid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER uid_messages AFTER INSERT ON messages WHEN NEW.uid IS NULL BEGIN
  UPDATE messages SET uid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER uid_reminders AFTER INSERT ON reminders WHEN NEW.uid IS NULL BEGIN
  UPDATE reminders SET uid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER sync_sessions_insert AFTER INSERT ON sessions WHEN NEW.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'sessions' AND pk = CAST(NEW.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'sessions', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_sessions_update AFTER UPDATE ON sessions WHEN OLD.uid IS NOT NEW.uid OR OLD.date IS NOT NEW.date OR OLD.started_at IS NOT NEW.started_at OR OLD.ended_at IS NOT NEW.ended_at OR OLD.status IS NOT NEW.status BEGIN
  DELETE FROM sync_changes WHERE tbl = 'sessions' AND pk = CAST(OLD.uid AS TEXT) AND OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'sessions', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  DELETE FROM sync_changes WHERE tbl = 'sessions' AND pk = CAST(NEW.uid AS TEXT) AND NEW.uid IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'sessions', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.uid IS NOT NULL;
END;

CREATE TRIGGER sync_sessions_delete AFTER DELETE ON sessions WHEN OLD.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'sessions' AND pk = CAST(OLD.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'sessions', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_captures_insert AFTER INSERT ON captures WHEN NEW.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'captures' AND pk = CAST(NEW.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'captures', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_captures_update AFTER UPDATE ON captures WHEN OLD.uid IS NOT NEW.uid OR OLD.created_at IS NOT NEW.created_at OR OLD.text IS NOT NEW.text OR OLD.mood_emoji IS NOT NEW.mood_emoji OR OLD.session_id IS NOT NEW.session_id OR OLD.external_id IS NOT NEW.external_id BEGIN
  DELETE FROM sync_changes WHERE tbl = 'captures' AND pk = CAST(OLD.uid AS TEXT) AND OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'captures', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  DELETE FROM sync_changes WHERE tbl = 'captures' AND pk = CAST(NEW.uid AS TEXT) AND NEW.uid IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'captures', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.uid IS NOT NULL;
END;

CREATE TRIGGER sync_captures_delete AFTER DELETE ON captures WHEN OLD.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'captures' AND pk = CAST(OLD.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'captures', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_messages_insert AFTER INSERT ON messages WHEN NEW.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'messages' AND pk = CAST(NEW.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'messages', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_messages_update AFTER UPDATE ON messages WHEN OLD.uid IS NOT NEW.uid OR OLD.session_id IS NOT NEW.session_id OR OLD.role IS NOT NEW.role OR OLD.content IS NOT NEW.content OR OLD.created_at IS NOT NEW.created_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'messages' AND pk = CAST(OLD.uid AS TEXT) AND OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'messages', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  DELETE FROM sync_changes WHERE tbl = 'messages' AND pk = CAST(NEW.uid AS TEXT) AND NEW.uid IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'messages', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.uid IS NOT NULL;
END;

CREATE TRIGGER sync_messages_delete AFTER DELETE ON messages WHEN OLD.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'messages' AND pk = CAST(OLD.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'messages', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_entries_insert AFTER INSERT ON entries WHEN NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'entries' AND pk = CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'entries', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_entries_update AFTER UPDATE ON entries WHEN OLD.date IS NOT NEW.date OR OLD.session_id IS NOT NEW.session_id OR OLD.title IS NOT NEW.title OR OLD.narrative IS NOT NEW.narrative OR OLD.highlights IS NOT NEW.highlights OR OLD.counselor_note IS NOT NEW.counselor_note OR OLD.user_edited IS NOT NEW.user_edited OR OLD.created_at IS NOT NEW.created_at OR OLD.paper IS NOT NEW.paper BEGIN
  DELETE FROM sync_changes WHERE tbl = 'entries' AND pk = CAST(OLD.date AS TEXT) AND OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'entries', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  DELETE FROM sync_changes WHERE tbl = 'entries' AND pk = CAST(NEW.date AS TEXT) AND NEW.date IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'entries', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.date IS NOT NULL;
END;

CREATE TRIGGER sync_entries_delete AFTER DELETE ON entries WHEN OLD.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'entries' AND pk = CAST(OLD.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'entries', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_day_metrics_insert AFTER INSERT ON day_metrics WHEN NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'day_metrics' AND pk = CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'day_metrics', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_day_metrics_update AFTER UPDATE ON day_metrics WHEN OLD.date IS NOT NEW.date OR OLD.mood IS NOT NEW.mood OR OLD.energy IS NOT NEW.energy OR OLD.summary_line IS NOT NEW.summary_line OR OLD.raw_json IS NOT NEW.raw_json BEGIN
  DELETE FROM sync_changes WHERE tbl = 'day_metrics' AND pk = CAST(OLD.date AS TEXT) AND OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'day_metrics', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  DELETE FROM sync_changes WHERE tbl = 'day_metrics' AND pk = CAST(NEW.date AS TEXT) AND NEW.date IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'day_metrics', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.date IS NOT NULL;
END;

CREATE TRIGGER sync_day_metrics_delete AFTER DELETE ON day_metrics WHEN OLD.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'day_metrics' AND pk = CAST(OLD.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'day_metrics', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_observations_insert AFTER INSERT ON observations WHEN NEW.kind IS NOT NULL AND NEW.key IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'observations' AND pk = CAST(NEW.kind AS TEXT) || char(31) || CAST(NEW.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'observations', CAST(NEW.kind AS TEXT) || char(31) || CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_observations_update AFTER UPDATE ON observations WHEN OLD.kind IS NOT NEW.kind OR OLD.key IS NOT NEW.key OR OLD.detail IS NOT NEW.detail OR OLD.sentiment IS NOT NEW.sentiment OR OLD.occurrences IS NOT NEW.occurrences OR OLD.first_seen IS NOT NEW.first_seen OR OLD.last_seen IS NOT NEW.last_seen OR OLD.pinned IS NOT NEW.pinned BEGIN
  DELETE FROM sync_changes WHERE tbl = 'observations' AND pk = CAST(OLD.kind AS TEXT) || char(31) || CAST(OLD.key AS TEXT) AND OLD.kind IS NOT NULL AND OLD.key IS NOT NULL AND ((OLD.kind IS NOT NEW.kind OR OLD.key IS NOT NEW.key));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'observations', CAST(OLD.kind AS TEXT) || char(31) || CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.kind IS NOT NULL AND OLD.key IS NOT NULL AND ((OLD.kind IS NOT NEW.kind OR OLD.key IS NOT NEW.key));
  DELETE FROM sync_changes WHERE tbl = 'observations' AND pk = CAST(NEW.kind AS TEXT) || char(31) || CAST(NEW.key AS TEXT) AND NEW.kind IS NOT NULL AND NEW.key IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'observations', CAST(NEW.kind AS TEXT) || char(31) || CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.kind IS NOT NULL AND NEW.key IS NOT NULL;
END;

CREATE TRIGGER sync_observations_delete AFTER DELETE ON observations WHEN OLD.kind IS NOT NULL AND OLD.key IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'observations' AND pk = CAST(OLD.kind AS TEXT) || char(31) || CAST(OLD.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'observations', CAST(OLD.kind AS TEXT) || char(31) || CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_profile_insert AFTER INSERT ON profile WHEN NEW.id IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'profile' AND pk = CAST(NEW.id AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'profile', CAST(NEW.id AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_profile_update AFTER UPDATE ON profile WHEN OLD.id IS NOT NEW.id OR OLD.summary IS NOT NEW.summary OR OLD.updated_at IS NOT NEW.updated_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'profile' AND pk = CAST(OLD.id AS TEXT) AND OLD.id IS NOT NULL AND ((OLD.id IS NOT NEW.id));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'profile', CAST(OLD.id AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.id IS NOT NULL AND ((OLD.id IS NOT NEW.id));
  DELETE FROM sync_changes WHERE tbl = 'profile' AND pk = CAST(NEW.id AS TEXT) AND NEW.id IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'profile', CAST(NEW.id AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.id IS NOT NULL;
END;

CREATE TRIGGER sync_profile_delete AFTER DELETE ON profile WHEN OLD.id IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'profile' AND pk = CAST(OLD.id AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'profile', CAST(OLD.id AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_weekly_reviews_insert AFTER INSERT ON weekly_reviews WHEN NEW.week_start IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'weekly_reviews' AND pk = CAST(NEW.week_start AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'weekly_reviews', CAST(NEW.week_start AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_weekly_reviews_update AFTER UPDATE ON weekly_reviews WHEN OLD.week_start IS NOT NEW.week_start OR OLD.letter IS NOT NEW.letter OR OLD.strengths IS NOT NEW.strengths OR OLD.focus_areas IS NOT NEW.focus_areas OR OLD.created_at IS NOT NEW.created_at OR OLD.source_days IS NOT NEW.source_days BEGIN
  DELETE FROM sync_changes WHERE tbl = 'weekly_reviews' AND pk = CAST(OLD.week_start AS TEXT) AND OLD.week_start IS NOT NULL AND ((OLD.week_start IS NOT NEW.week_start));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'weekly_reviews', CAST(OLD.week_start AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.week_start IS NOT NULL AND ((OLD.week_start IS NOT NEW.week_start));
  DELETE FROM sync_changes WHERE tbl = 'weekly_reviews' AND pk = CAST(NEW.week_start AS TEXT) AND NEW.week_start IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'weekly_reviews', CAST(NEW.week_start AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.week_start IS NOT NULL;
END;

CREATE TRIGGER sync_weekly_reviews_delete AFTER DELETE ON weekly_reviews WHEN OLD.week_start IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'weekly_reviews' AND pk = CAST(OLD.week_start AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'weekly_reviews', CAST(OLD.week_start AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_monthly_reports_insert AFTER INSERT ON monthly_reports WHEN NEW.month IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'monthly_reports' AND pk = CAST(NEW.month AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'monthly_reports', CAST(NEW.month AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_monthly_reports_update AFTER UPDATE ON monthly_reports WHEN OLD.month IS NOT NEW.month OR OLD.letter IS NOT NEW.letter OR OLD.changed IS NOT NEW.changed OR OLD.stats IS NOT NEW.stats OR OLD.source_days IS NOT NEW.source_days OR OLD.created_at IS NOT NEW.created_at OR OLD.formulation IS NOT NEW.formulation BEGIN
  DELETE FROM sync_changes WHERE tbl = 'monthly_reports' AND pk = CAST(OLD.month AS TEXT) AND OLD.month IS NOT NULL AND ((OLD.month IS NOT NEW.month));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'monthly_reports', CAST(OLD.month AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.month IS NOT NULL AND ((OLD.month IS NOT NEW.month));
  DELETE FROM sync_changes WHERE tbl = 'monthly_reports' AND pk = CAST(NEW.month AS TEXT) AND NEW.month IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'monthly_reports', CAST(NEW.month AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.month IS NOT NULL;
END;

CREATE TRIGGER sync_monthly_reports_delete AFTER DELETE ON monthly_reports WHEN OLD.month IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'monthly_reports' AND pk = CAST(OLD.month AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'monthly_reports', CAST(OLD.month AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_memory_summaries_insert AFTER INSERT ON memory_summaries WHEN NEW.number IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'memory_summaries' AND pk = CAST(NEW.number AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_summaries', CAST(NEW.number AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_memory_summaries_update AFTER UPDATE ON memory_summaries WHEN OLD.number IS NOT NEW.number OR OLD.period_start IS NOT NEW.period_start OR OLD.period_end IS NOT NEW.period_end OR OLD.summary IS NOT NEW.summary OR OLD.source_days IS NOT NEW.source_days OR OLD.created_at IS NOT NEW.created_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'memory_summaries' AND pk = CAST(OLD.number AS TEXT) AND OLD.number IS NOT NULL AND ((OLD.number IS NOT NEW.number));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_summaries', CAST(OLD.number AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.number IS NOT NULL AND ((OLD.number IS NOT NEW.number));
  DELETE FROM sync_changes WHERE tbl = 'memory_summaries' AND pk = CAST(NEW.number AS TEXT) AND NEW.number IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_summaries', CAST(NEW.number AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.number IS NOT NULL;
END;

CREATE TRIGGER sync_memory_summaries_delete AFTER DELETE ON memory_summaries WHEN OLD.number IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'memory_summaries' AND pk = CAST(OLD.number AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_summaries', CAST(OLD.number AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_reminders_insert AFTER INSERT ON reminders WHEN NEW.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'reminders' AND pk = CAST(NEW.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'reminders', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_reminders_update AFTER UPDATE ON reminders WHEN OLD.uid IS NOT NEW.uid OR OLD.due_at IS NOT NEW.due_at OR OLD.text IS NOT NEW.text OR OLD.status IS NOT NEW.status OR OLD.created_at IS NOT NEW.created_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'reminders' AND pk = CAST(OLD.uid AS TEXT) AND OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'reminders', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  DELETE FROM sync_changes WHERE tbl = 'reminders' AND pk = CAST(NEW.uid AS TEXT) AND NEW.uid IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'reminders', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.uid IS NOT NULL;
END;

CREATE TRIGGER sync_reminders_delete AFTER DELETE ON reminders WHEN OLD.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'reminders' AND pk = CAST(OLD.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'reminders', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_documents_insert AFTER INSERT ON documents WHEN NEW.name IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'documents' AND pk = CAST(NEW.name AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'documents', CAST(NEW.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_documents_update AFTER UPDATE ON documents WHEN OLD.name IS NOT NEW.name OR OLD.content IS NOT NEW.content OR OLD.enabled IS NOT NEW.enabled OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'documents' AND pk = CAST(OLD.name AS TEXT) AND OLD.name IS NOT NULL AND ((OLD.name IS NOT NEW.name));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'documents', CAST(OLD.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.name IS NOT NULL AND ((OLD.name IS NOT NEW.name));
  DELETE FROM sync_changes WHERE tbl = 'documents' AND pk = CAST(NEW.name AS TEXT) AND NEW.name IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'documents', CAST(NEW.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.name IS NOT NULL;
END;

CREATE TRIGGER sync_documents_delete AFTER DELETE ON documents WHEN OLD.name IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'documents' AND pk = CAST(OLD.name AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'documents', CAST(OLD.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_checkins_insert AFTER INSERT ON checkins WHEN NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'checkins' AND pk = CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'checkins', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_checkins_update AFTER UPDATE ON checkins WHEN OLD.date IS NOT NEW.date OR OLD.mood IS NOT NEW.mood OR OLD.energy IS NOT NEW.energy OR OLD.sleep_hours IS NOT NEW.sleep_hours OR OLD.feeling IS NOT NEW.feeling OR OLD.on_mind IS NOT NEW.on_mind OR OLD.habits IS NOT NEW.habits OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.bedtime IS NOT NEW.bedtime OR OLD.wake_time IS NOT NEW.wake_time OR OLD.sleep_latency_min IS NOT NEW.sleep_latency_min OR OLD.sleep_quality IS NOT NEW.sleep_quality OR OLD.lunch IS NOT NEW.lunch OR OLD.evening_break IS NOT NEW.evening_break OR OLD.dinner IS NOT NEW.dinner BEGIN
  DELETE FROM sync_changes WHERE tbl = 'checkins' AND pk = CAST(OLD.date AS TEXT) AND OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'checkins', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  DELETE FROM sync_changes WHERE tbl = 'checkins' AND pk = CAST(NEW.date AS TEXT) AND NEW.date IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'checkins', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.date IS NOT NULL;
END;

CREATE TRIGGER sync_checkins_delete AFTER DELETE ON checkins WHEN OLD.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'checkins' AND pk = CAST(OLD.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'checkins', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_habit_prefs_insert AFTER INSERT ON habit_prefs WHEN NEW.key IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'habit_prefs' AND pk = CAST(NEW.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'habit_prefs', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_habit_prefs_update AFTER UPDATE ON habit_prefs WHEN OLD.key IS NOT NEW.key OR OLD.dismissed IS NOT NEW.dismissed OR OLD.direction IS NOT NEW.direction BEGIN
  DELETE FROM sync_changes WHERE tbl = 'habit_prefs' AND pk = CAST(OLD.key AS TEXT) AND OLD.key IS NOT NULL AND ((OLD.key IS NOT NEW.key));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'habit_prefs', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.key IS NOT NULL AND ((OLD.key IS NOT NEW.key));
  DELETE FROM sync_changes WHERE tbl = 'habit_prefs' AND pk = CAST(NEW.key AS TEXT) AND NEW.key IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'habit_prefs', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.key IS NOT NULL;
END;

CREATE TRIGGER sync_habit_prefs_delete AFTER DELETE ON habit_prefs WHEN OLD.key IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'habit_prefs' AND pk = CAST(OLD.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'habit_prefs', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_assessments_insert AFTER INSERT ON assessments WHEN NEW.instrument IS NOT NULL AND NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'assessments' AND pk = CAST(NEW.instrument AS TEXT) || char(31) || CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'assessments', CAST(NEW.instrument AS TEXT) || char(31) || CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_assessments_update AFTER UPDATE ON assessments WHEN OLD.instrument IS NOT NEW.instrument OR OLD.date IS NOT NEW.date OR OLD.answers IS NOT NEW.answers OR OLD.score IS NOT NEW.score OR OLD.difficulty IS NOT NEW.difficulty OR OLD.created_at IS NOT NEW.created_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'assessments' AND pk = CAST(OLD.instrument AS TEXT) || char(31) || CAST(OLD.date AS TEXT) AND OLD.instrument IS NOT NULL AND OLD.date IS NOT NULL AND ((OLD.instrument IS NOT NEW.instrument OR OLD.date IS NOT NEW.date));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'assessments', CAST(OLD.instrument AS TEXT) || char(31) || CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.instrument IS NOT NULL AND OLD.date IS NOT NULL AND ((OLD.instrument IS NOT NEW.instrument OR OLD.date IS NOT NEW.date));
  DELETE FROM sync_changes WHERE tbl = 'assessments' AND pk = CAST(NEW.instrument AS TEXT) || char(31) || CAST(NEW.date AS TEXT) AND NEW.instrument IS NOT NULL AND NEW.date IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'assessments', CAST(NEW.instrument AS TEXT) || char(31) || CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.instrument IS NOT NULL AND NEW.date IS NOT NULL;
END;

CREATE TRIGGER sync_assessments_delete AFTER DELETE ON assessments WHEN OLD.instrument IS NOT NULL AND OLD.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'assessments' AND pk = CAST(OLD.instrument AS TEXT) || char(31) || CAST(OLD.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'assessments', CAST(OLD.instrument AS TEXT) || char(31) || CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_settings_insert AFTER INSERT ON settings WHEN NEW.key IS NOT NULL AND NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until') BEGIN
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(NEW.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_settings_update AFTER UPDATE ON settings WHEN OLD.key IS NOT NEW.key OR OLD.value IS NOT NEW.value BEGIN
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(OLD.key AS TEXT) AND OLD.key IS NOT NULL AND OLD.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until') AND ((OLD.key IS NOT NEW.key) OR NOT (NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until')));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.key IS NOT NULL AND OLD.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until') AND ((OLD.key IS NOT NEW.key) OR NOT (NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until')));
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(NEW.key AS TEXT) AND NEW.key IS NOT NULL AND NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until');
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.key IS NOT NULL AND NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until');
END;

CREATE TRIGGER sync_settings_delete AFTER DELETE ON settings WHEN OLD.key IS NOT NULL AND OLD.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until') BEGIN
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(OLD.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

