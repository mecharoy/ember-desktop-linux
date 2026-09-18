-- The points that split a day into parts for the evening conversation, from
-- the check-in: each is "HH:MM", "not-yet", "skipped", or NULL when left blank.
ALTER TABLE checkins ADD COLUMN lunch TEXT;
ALTER TABLE checkins ADD COLUMN evening_break TEXT;
ALTER TABLE checkins ADD COLUMN dinner TEXT;
