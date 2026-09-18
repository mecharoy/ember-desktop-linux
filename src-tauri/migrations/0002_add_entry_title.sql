-- Entry titles, written by the journal writer.
ALTER TABLE entries ADD COLUMN title TEXT NOT NULL DEFAULT '';
