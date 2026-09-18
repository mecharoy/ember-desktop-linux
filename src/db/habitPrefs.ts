// Per-habit choices (migration 0007): dismissed ("not a habit") and
// direction ("less" = something to do less of). Kept out of the observations
// table because that one is wiped and re-derived after every extraction.

import { getDb } from "./client";
import { canonicalKey } from "./observationFold";
import type { HabitPref } from "./types";

export async function listHabitPrefs(): Promise<HabitPref[]> {
  const db = await getDb();
  return db.select<HabitPref[]>("SELECT * FROM habit_prefs");
}

/** Canonical keys of habits the user dismissed. */
export async function listDismissedHabitKeys(): Promise<Set<string>> {
  const prefs = await listHabitPrefs();
  return new Set(prefs.filter((p) => p.dismissed === 1).map((p) => p.key));
}

export async function setHabitDismissed(key: string, dismissed: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO habit_prefs (key, dismissed) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET dismissed = excluded.dismissed`,
    [canonicalKey(key), dismissed ? 1 : 0],
  );
}

export async function setHabitDirection(key: string, direction: "less" | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO habit_prefs (key, direction) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET direction = excluded.direction`,
    [canonicalKey(key), direction],
  );
}
