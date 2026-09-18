-- Sync bookkeeping that must outlive a reset. reset_at: when the journal was
-- last reset, here or on a paired device (UTC); a reset newer than this one,
-- arriving through sync, resets this device too.
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
