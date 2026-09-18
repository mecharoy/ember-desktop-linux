-- Memory for small models: what Ember knows about them, kept in a few short
-- files they can read and edit, and per conversation a short briefing and a
-- running summary of the chat so far.

-- name: people | behaviours | patterns | goals ("About me" is the profile table).
-- user_edited = 1 once they changed it by hand; updates keep their wording.
CREATE TABLE memory_files (
  name TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  user_edited INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- The preparation step's briefing for the conversation, and the summary of
-- the part of the chat that no longer fits a small model (messages before
-- summary_upto, counted in the session's message order).
ALTER TABLE session_agendas ADD COLUMN briefing TEXT;
ALTER TABLE session_agendas ADD COLUMN chat_summary TEXT;
ALTER TABLE session_agendas ADD COLUMN summary_upto INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER sync_session_agendas_insert;
DROP TRIGGER sync_session_agendas_update;
DROP TRIGGER sync_session_agendas_delete;

CREATE TRIGGER sync_session_agendas_insert AFTER INSERT ON session_agendas WHEN NEW.date IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'session_agendas' AND pk = CAST(NEW.date AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'session_agendas', CAST(NEW.date AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_session_agendas_update AFTER UPDATE ON session_agendas WHEN OLD.date IS NOT NEW.date OR OLD.items IS NOT NEW.items OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.briefing IS NOT NEW.briefing OR OLD.chat_summary IS NOT NEW.chat_summary OR OLD.summary_upto IS NOT NEW.summary_upto BEGIN
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

CREATE TRIGGER sync_memory_files_insert AFTER INSERT ON memory_files WHEN NEW.name IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'memory_files' AND pk = CAST(NEW.name AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_files', CAST(NEW.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_memory_files_update AFTER UPDATE ON memory_files WHEN OLD.name IS NOT NEW.name OR OLD.content IS NOT NEW.content OR OLD.user_edited IS NOT NEW.user_edited OR OLD.updated_at IS NOT NEW.updated_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'memory_files' AND pk = CAST(OLD.name AS TEXT) AND OLD.name IS NOT NULL AND ((OLD.name IS NOT NEW.name));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_files', CAST(OLD.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.name IS NOT NULL AND ((OLD.name IS NOT NEW.name));
  DELETE FROM sync_changes WHERE tbl = 'memory_files' AND pk = CAST(NEW.name AS TEXT) AND NEW.name IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_files', CAST(NEW.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.name IS NOT NULL;
END;

CREATE TRIGGER sync_memory_files_delete AFTER DELETE ON memory_files WHEN OLD.name IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'memory_files' AND pk = CAST(OLD.name AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'memory_files', CAST(OLD.name AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;
