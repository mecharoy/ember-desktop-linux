-- Phase 6 efficiency pass: the hot lookups are captures-by-day (queried as
-- created_at range predicates — ISO local strings compare lexicographically,
-- so the index serves them) and messages-by-session.
CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
