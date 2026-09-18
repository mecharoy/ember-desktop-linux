-- The conversation checklist and the topics Ember keeps working on with them,
-- what they did between the points of the day (in the check-in), and more
-- settings that travel between paired devices.

-- What they did in each stretch of the day, in their own words:
-- JSON {"morning": text, "afternoon": text, "evening": text, "night": text}.
ALTER TABLE checkins ADD COLUMN day_notes TEXT;

-- The checklist Ember makes before a conversation: one per day.
-- items: JSON [{id, section: "past" | "today" | "future", text, state: "open" | "done" | "skip", topic}].
CREATE TABLE session_agendas (
  date TEXT PRIMARY KEY,
  items TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Things they are working through, kept across conversations (coach and
-- therapist styles only). status: open | resolved | avoid.
CREATE TABLE topics (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_discussed TEXT,
  updated_at TEXT NOT NULL
);

DROP TRIGGER sync_checkins_insert;
DROP TRIGGER sync_checkins_update;
DROP TRIGGER sync_checkins_delete;
DROP TRIGGER sync_settings_insert;
DROP TRIGGER sync_settings_update;
DROP TRIGGER sync_settings_delete;

CREATE TRIGGER sync_checkins_insert AFTER INSERT ON checkins WHEN NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'checkins' AND pk = CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'checkins', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_checkins_update AFTER UPDATE ON checkins WHEN OLD.date IS NOT NEW.date OR OLD.mood IS NOT NEW.mood OR OLD.energy IS NOT NEW.energy OR OLD.sleep_hours IS NOT NEW.sleep_hours OR OLD.feeling IS NOT NEW.feeling OR OLD.on_mind IS NOT NEW.on_mind OR OLD.habits IS NOT NEW.habits OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.bedtime IS NOT NEW.bedtime OR OLD.wake_time IS NOT NEW.wake_time OR OLD.sleep_latency_min IS NOT NEW.sleep_latency_min OR OLD.sleep_quality IS NOT NEW.sleep_quality OR OLD.lunch IS NOT NEW.lunch OR OLD.evening_break IS NOT NEW.evening_break OR OLD.dinner IS NOT NEW.dinner OR OLD.day_notes IS NOT NEW.day_notes BEGIN
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

CREATE TRIGGER sync_session_agendas_insert AFTER INSERT ON session_agendas WHEN NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'session_agendas' AND pk = CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'session_agendas', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_session_agendas_update AFTER UPDATE ON session_agendas WHEN OLD.date IS NOT NEW.date OR OLD.items IS NOT NEW.items OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'session_agendas' AND pk = CAST(OLD.date AS TEXT) AND OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'session_agendas', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.date IS NOT NULL AND ((OLD.date IS NOT NEW.date));
  DELETE FROM sync_changes WHERE tbl = 'session_agendas' AND pk = CAST(NEW.date AS TEXT) AND NEW.date IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'session_agendas', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.date IS NOT NULL;
END;

CREATE TRIGGER sync_session_agendas_delete AFTER DELETE ON session_agendas WHEN OLD.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'session_agendas' AND pk = CAST(OLD.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'session_agendas', CAST(OLD.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_topics_insert AFTER INSERT ON topics WHEN NEW.key IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'topics' AND pk = CAST(NEW.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'topics', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_topics_update AFTER UPDATE ON topics WHEN OLD.key IS NOT NEW.key OR OLD.title IS NOT NEW.title OR OLD.status IS NOT NEW.status OR OLD.notes IS NOT NEW.notes OR OLD.next_step IS NOT NEW.next_step OR OLD.first_seen IS NOT NEW.first_seen OR OLD.last_discussed IS NOT NEW.last_discussed OR OLD.updated_at IS NOT NEW.updated_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'topics' AND pk = CAST(OLD.key AS TEXT) AND OLD.key IS NOT NULL AND ((OLD.key IS NOT NEW.key));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'topics', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.key IS NOT NULL AND ((OLD.key IS NOT NEW.key));
  DELETE FROM sync_changes WHERE tbl = 'topics' AND pk = CAST(NEW.key AS TEXT) AND NEW.key IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'topics', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.key IS NOT NULL;
END;

CREATE TRIGGER sync_topics_delete AFTER DELETE ON topics WHEN OLD.key IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'topics' AND pk = CAST(OLD.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'topics', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_settings_insert AFTER INSERT ON settings WHEN NEW.key IS NOT NULL AND NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns') BEGIN
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(NEW.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_settings_update AFTER UPDATE ON settings WHEN OLD.key IS NOT NEW.key OR OLD.value IS NOT NEW.value BEGIN
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(OLD.key AS TEXT) AND OLD.key IS NOT NULL AND OLD.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns') AND ((OLD.key IS NOT NEW.key) OR NOT (NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns')));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.key IS NOT NULL AND OLD.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns') AND ((OLD.key IS NOT NEW.key) OR NOT (NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns')));
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(NEW.key AS TEXT) AND NEW.key IS NOT NULL AND NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns');
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(NEW.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.key IS NOT NULL AND NEW.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns');
END;

CREATE TRIGGER sync_settings_delete AFTER DELETE ON settings WHEN OLD.key IS NOT NULL AND OLD.key IN ('user_name', 'voice', 'chat_length_preference', 'conversation_tone', 'conversation_approach', 'journal_paper', 'hidden_modules', 'assessments_enabled', 'assessments_snoozed_until', 'writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns') BEGIN
  DELETE FROM sync_changes WHERE tbl = 'settings' AND pk = CAST(OLD.key AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'settings', CAST(OLD.key AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
SELECT 'settings', CAST(key AS TEXT), (SELECT COALESCE(MAX(rev), 0) FROM sync_changes) + ROW_NUMBER() OVER (), '1970-01-01T00:00:00.000Z', 0, NULL
  FROM settings WHERE key IN ('writing_style_sample', 'usual_lunch', 'usual_break', 'usual_dinner', 'insight_patterns');
