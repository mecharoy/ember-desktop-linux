import { getDb } from "./client";
import { listAllDayMetrics } from "./metrics";
import { canonicalKey, foldMetricsIntoObservations, observationScore } from "./observationFold";
import type { Observation } from "./types";

/**
 * Rebuilds the observations table from every day_metrics row (see
 * observationFold.ts for why derive-and-replace beats incremental updates).
 * User-set pinned flags and descriptions survive the rebuild, matched
 * case-insensitively.
 */
export async function rebuildObservations(): Promise<void> {
  const db = await getDb();
  const metrics = await listAllDayMetrics();
  const aggregates = foldMetricsIntoObservations(metrics);

  const existing = await db.select<Observation[]>("SELECT kind, key, detail, pinned, first_seen, last_seen FROM observations");
  const pinnedIdentities = new Set(
    existing.filter((o) => o.pinned === 1).map((o) => `${o.kind} ${canonicalKey(o.key)}`),
  );
  const detailByIdentity = new Map(
    existing.filter((o) => o.detail).map((o) => [`${o.kind} ${canonicalKey(o.key)}`, o.detail]),
  );

  await db.execute("DELETE FROM observations");
  for (const a of aggregates) {
    const identity = `${a.kind} ${canonicalKey(a.key)}`;
    const pinned = pinnedIdentities.has(identity) ? 1 : 0;
    const detail = detailByIdentity.get(identity) ?? null;
    await db.execute(
      `INSERT INTO observations (kind, key, detail, sentiment, occurrences, first_seen, last_seen, pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.kind, a.key, detail, a.sentiment, a.occurrences, a.first_seen, a.last_seen, pinned],
    );
  }
  // A habit they added themselves (from a suggestion) may not be in any entry
  // yet; it stays pinned until it is.
  const derived = new Set(aggregates.map((a) => `${a.kind} ${canonicalKey(a.key)}`));
  for (const o of existing) {
    if (o.kind !== "habit" || o.pinned !== 1 || derived.has(`habit ${canonicalKey(o.key)}`)) continue;
    await db.execute(
      `INSERT INTO observations (kind, key, detail, sentiment, occurrences, first_seen, last_seen, pinned)
       VALUES ('habit', $1, $2, NULL, 0, $3, $4, 1)`,
      [o.key, o.detail, o.first_seen, o.last_seen],
    );
  }
}

export async function listObservations(kind?: Observation["kind"]): Promise<Observation[]> {
  const db = await getDb();
  if (kind) {
    return db.select<Observation[]>(
      "SELECT * FROM observations WHERE kind = $1 ORDER BY last_seen DESC, occurrences DESC",
      [kind],
    );
  }
  return db.select<Observation[]>(
    "SELECT * FROM observations ORDER BY last_seen DESC, occurrences DESC",
  );
}

/** Up to `limit` observations ranked by recency × occurrences. */
export async function listTopObservations(todayKey: string, limit = 15): Promise<Observation[]> {
  const all = await listObservations();
  return all
    .slice()
    .sort((a, b) => observationScore(b, todayKey) - observationScore(a, todayKey))
    .slice(0, limit);
}

/** Pins a habit spotted in the entries. The observations table is only
 *  rebuilt after an extraction, so when it hasn't caught up with the day
 *  metrics yet, it is rebuilt first. */
export async function pinHabit(key: string, detail?: string): Promise<void> {
  const db = await getDb();
  const find = async () =>
    (await listObservations("habit")).find((o) => canonicalKey(o.key) === canonicalKey(key));
  let obs = await find();
  if (!obs) {
    await rebuildObservations();
    obs = await find();
  }
  if (!obs) throw new Error(`No habit called "${key}" in your entries.`);
  await db.execute("UPDATE observations SET pinned = 1 WHERE id = $1", [obs.id]);
  const trimmedDetail = detail?.trim();
  if (trimmedDetail && !obs.detail) {
    await db.execute("UPDATE observations SET detail = $1 WHERE id = $2", [trimmedDetail, obs.id]);
  }
}

/** Starts tracking a habit by name, whether or not it has come up in an
 *  entry yet (a suggestion they took up). `detail` is the small description
 *  shown alongside the habit, e.g. the fuller suggestion it came from. */
export async function addTrackedHabit(key: string, today: string, detail?: string): Promise<void> {
  const name = key.trim();
  if (!name) return;
  try {
    await pinHabit(name, detail);
  } catch {
    const db = await getDb();
    await db.execute(
      `INSERT INTO observations (kind, key, detail, sentiment, occurrences, first_seen, last_seen, pinned)
       VALUES ('habit', $1, $2, NULL, 0, $3, $3, 1)`,
      [name, detail?.trim() || null, today],
    );
  }
}

/** Sets or clears the small description shown under a tracked habit. */
export async function setObservationDetail(id: number, detail: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE observations SET detail = $1 WHERE id = $2", [detail.trim() || null, id]);
}

/** User promotes/demotes a discovered habit to a tracked one. */
export async function setObservationPinned(id: number, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE observations SET pinned = $1 WHERE id = $2", [pinned ? 1 : 0, id]);
}
