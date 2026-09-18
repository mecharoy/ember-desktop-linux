-- The paper an entry is written on in the Journal (ember-mobile). NULL means
-- the default paper chosen in Settings. Only a look: nothing reads it but the
-- page that draws the entry.
ALTER TABLE entries ADD COLUMN paper TEXT;
