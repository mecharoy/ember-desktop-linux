-- Captures imported from elsewhere keep their original id, so importing
-- the same file twice doesn't duplicate them. Local captures leave it NULL.
ALTER TABLE captures ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_captures_external_id
  ON captures(external_id) WHERE external_id IS NOT NULL;
