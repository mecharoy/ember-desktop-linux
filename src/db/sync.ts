import { getDb } from "./client";

// Sync between Elytra on a computer and Elytra on a phone (migration 0011).
//
// Triggers log every change into sync_changes. collectChanges() reads what a
// peer hasn't seen yet, with the rows attached; applyChanges() writes a
// peer's changes here. The newest change to a row wins, with two exceptions
// for sessions, which both devices create for the same day on their own:
// two sessions for one day merge into one, and a "skipped" never overrides a
// session that was wrapped up.
//
// A reset travels too: resetting either device resets the other at the next
// sync, except for notes it never received and anything written after the
// reset, which are kept and carried over.

/** One changed row as it travels. `row` is absent for deletions. */
export interface SyncChange {
  t: string;
  k: string;
  at: string;
  del: 0 | 1;
  row?: Record<string, unknown>;
  /** For rows that belong to a session: that session, so it lands first. */
  session?: { row: SessionRow; at: string } | null;
}

export interface SyncBatch {
  changes: SyncChange[];
  /** Pass back as `since` next time. */
  upTo: number;
  more: boolean;
}

export interface ApplyResult {
  tables: string[];
  /** Days whose notes, conversation, entry or check-in changed. */
  dates: string[];
}

export interface SyncPeer {
  peer_id: string;
  name: string;
  sent_rev: number;
  received_rev: number;
  last_sync_at: string | null;
}

interface SessionRow {
  uid: string;
  date: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
}

interface TableSpec {
  pk: string[];
  cols: string[];
  /** Has a session_id column, sent as session_uid. */
  session?: "required" | "optional";
}

// Must match the tables and columns in 0011_sync.sql, 0013 and 0014. Sessions come first so
// a batch creates them before anything that points at them.
const TABLES: Record<string, TableSpec> = {
  sessions: { pk: ["uid"], cols: ["date", "started_at", "ended_at", "status"] },
  captures: { pk: ["uid"], cols: ["created_at", "text", "mood_emoji", "external_id"], session: "optional" },
  messages: { pk: ["uid"], cols: ["role", "content", "created_at"], session: "required" },
  entries: {
    pk: ["date"],
    cols: ["title", "narrative", "highlights", "counselor_note", "user_edited", "created_at", "paper"],
    session: "required",
  },
  day_metrics: { pk: ["date"], cols: ["mood", "energy", "summary_line", "raw_json"] },
  observations: { pk: ["kind", "key"], cols: ["detail", "sentiment", "occurrences", "first_seen", "last_seen", "pinned"] },
  profile: { pk: ["id"], cols: ["summary", "updated_at"] },
  weekly_reviews: { pk: ["week_start"], cols: ["letter", "strengths", "focus_areas", "created_at", "source_days"] },
  monthly_reports: { pk: ["month"], cols: ["letter", "changed", "stats", "source_days", "created_at", "formulation"] },
  memory_summaries: { pk: ["number"], cols: ["period_start", "period_end", "summary", "source_days", "created_at"] },
  reminders: { pk: ["uid"], cols: ["due_at", "text", "status", "created_at"] },
  documents: { pk: ["name"], cols: ["content", "enabled", "created_at", "updated_at"] },
  checkins: {
    pk: ["date"],
    cols: [
      "mood", "energy", "sleep_hours", "feeling", "on_mind", "habits", "created_at", "updated_at",
      "bedtime", "wake_time", "sleep_latency_min", "sleep_quality", "lunch", "evening_break", "dinner", "day_notes",
    ],
  },
  session_agendas: { pk: ["date"], cols: ["items", "created_at", "updated_at", "briefing", "chat_summary", "summary_upto"] },
  memory_files: { pk: ["name"], cols: ["content", "user_edited", "updated_at"] },
  topics: { pk: ["key"], cols: ["title", "status", "notes", "next_step", "first_seen", "last_discussed", "updated_at"] },
  habit_prefs: { pk: ["key"], cols: ["dismissed", "direction"] },
  assessments: { pk: ["instrument", "date"], cols: ["answers", "score", "difficulty", "created_at"] },
  settings: { pk: ["key"], cols: ["value"] },
};

const TABLE_ORDER = Object.keys(TABLES);
const STATUS_RANK: Record<string, number> = { skipped: 0, open: 1, wrapped: 2 };

function pkSql(spec: TableSpec, alias = ""): string {
  return spec.pk.map((c) => `CAST(${alias}${c} AS TEXT)`).join(" || char(31) || ");
}

function nowUtc(): string {
  return new Date().toISOString();
}

// ---------- reading ----------

/** The highest revision logged here. */
export async function currentRev(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ rev: number | null }[]>("SELECT MAX(rev) AS rev FROM sync_changes");
  return Number(rows[0]?.rev ?? 0);
}

async function readSession(where: string, value: unknown): Promise<(SessionRow & { id: number }) | null> {
  const db = await getDb();
  const rows = await db.select<(SessionRow & { id: number })[]>(
    `SELECT id, uid, date, started_at, ended_at, status FROM sessions WHERE ${where} = $1`,
    [value],
  );
  return rows[0] ?? null;
}

async function readRow(table: string, pk: string): Promise<Record<string, unknown> | null> {
  const spec = TABLES[table];
  const db = await getDb();
  const cols = [...spec.pk, ...spec.cols].map((c) => `t.${c}`);
  if (spec.session) cols.push("s.uid AS session_uid", "t.session_id AS session_id");
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT ${cols.join(", ")} FROM ${table} t
     ${spec.session ? "LEFT JOIN sessions s ON s.id = t.session_id" : ""}
     WHERE ${pkSql(spec, "t.")} = $1`,
    [pk],
  );
  return rows[0] ?? null;
}

async function changedAt(table: string, pk: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ changed_at: string }[]>(
    "SELECT changed_at FROM sync_changes WHERE tbl = $1 AND pk = $2",
    [table, pk],
  );
  return rows[0]?.changed_at ?? null;
}

/**
 * Changes a peer hasn't seen: past `sinceRev`, and not ones that came from it.
 *
 * The origin tag is an optimisation AND part of how a reset travels, so it
 * stays — but it is only true while the peer keeps its journal. When a device
 * is reinstalled, cleared or restored it loses rows it wrote itself, and those
 * are tagged with its own id forever. `forgetPeerOrigin` drops the tags the
 * moment we learn a peer holds nothing of ours, which is the only way those
 * rows can ever be offered again (error.txt, 2026-09-22).
 */
export async function collectChanges(sinceRev: number, peerId: string, limit = 300): Promise<SyncBatch> {
  const db = await getDb();
  const logged = await db.select<{ tbl: string; pk: string; rev: number; changed_at: string; deleted: number }[]>(
    `SELECT tbl, pk, rev, changed_at, deleted FROM sync_changes
      WHERE rev > $1 AND (origin IS NULL OR origin <> $2)
      ORDER BY rev LIMIT $3`,
    [sinceRev, peerId, limit],
  );
  const changes: SyncChange[] = [];
  for (const c of logged) {
    if (!TABLES[c.tbl]) continue;
    if (c.deleted) {
      changes.push({ t: c.tbl, k: c.pk, at: c.changed_at, del: 1 });
      continue;
    }
    const row = await readRow(c.tbl, c.pk);
    if (!row) continue; // deleted since; its deletion is logged later
    const change: SyncChange = { t: c.tbl, k: c.pk, at: c.changed_at, del: 0 };
    if (TABLES[c.tbl].session) {
      const sessionId = row.session_id;
      delete row.session_id;
      const session = sessionId == null ? null : await readSession("id", sessionId);
      if (session) {
        const { id: _id, ...sessionRow } = session;
        change.session = { row: sessionRow, at: (await changedAt("sessions", session.uid)) ?? c.changed_at };
      } else {
        change.session = null;
      }
    }
    change.row = row;
    changes.push(change);
  }
  return {
    changes,
    upTo: logged.length > 0 ? Number(logged[logged.length - 1].rev) : sinceRev,
    more: logged.length === limit,
  };
}

// ---------- writing ----------

/** Records that a row now matches what the peer sent. A fresh revision, so
 *  any third device still hears about it, but tagged so it isn't echoed. */
async function markApplied(table: string, pk: string, at: string, deleted: 0 | 1, origin: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
     VALUES ($1, $2, (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), $3, $4, $5)`,
    [table, pk, at, deleted, origin],
  );
}

/** Marks a row as changed here, so it goes back to the peer. Stamped later
 *  than the change it answers, even within the same millisecond, or the
 *  peer would keep its own. */
async function markLocal(table: string, pk: string, after: string): Promise<void> {
  const db = await getDb();
  const now = nowUtc();
  const at = now > after ? now : new Date(Date.parse(after) + 1).toISOString();
  await db.execute(
    `INSERT OR REPLACE INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
     VALUES ($1, $2, (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), $3, 0, NULL)`,
    [table, pk, at],
  );
}

/** True when a change made here is newer than the incoming one. */
async function localIsNewer(table: string, pk: string, at: string): Promise<boolean> {
  const local = await changedAt(table, pk);
  return local !== null && local >= at;
}

async function sessionInUse(id: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ used: number }[]>(
    `SELECT EXISTS (SELECT 1 FROM messages WHERE session_id = $1)
         OR EXISTS (SELECT 1 FROM captures WHERE session_id = $1)
         OR EXISTS (SELECT 1 FROM entries WHERE session_id = $1) AS used`,
    [id],
  );
  return Boolean(rows[0]?.used);
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Writes an incoming session. Returns nothing; children look it up after. */
async function applySession(row: SessionRow, at: string, peerId: string): Promise<void> {
  if (await localIsNewer("sessions", row.uid, at)) return;
  const db = await getDb();
  const mine = await readSession("uid", row.uid);

  if (mine) {
    const status = row.status === "skipped" && mine.status === "wrapped" ? "wrapped" : row.status;
    let date = row.date;
    if (date !== mine.date) {
      const other = await readSession("date", date);
      if (other && other.uid !== row.uid) {
        if (await sessionInUse(other.id)) date = mine.date;
        else await db.execute("DELETE FROM sessions WHERE id = $1", [other.id]);
      }
    }
    await db.execute(
      "UPDATE sessions SET date = $1, started_at = $2, ended_at = $3, status = $4 WHERE id = $5",
      [date, row.started_at, row.ended_at, status, mine.id],
    );
    if (status !== row.status || date !== row.date) await markLocal("sessions", row.uid, at);
    else await markApplied("sessions", row.uid, at, 0, peerId);
    return;
  }

  const sameDay = await readSession("date", row.date);
  if (!sameDay) {
    await db.execute(
      "INSERT INTO sessions (uid, date, started_at, ended_at, status) VALUES ($1, $2, $3, $4, $5)",
      [row.uid, row.date, row.started_at, row.ended_at, row.status],
    );
    await markApplied("sessions", row.uid, at, 0, peerId);
    return;
  }

  // One day, two sessions made apart: they become one. Both devices pick the
  // smaller uid, so they settle on the same one whichever merges first.
  const merged = {
    uid: sameDay.uid < row.uid ? sameDay.uid : row.uid,
    started_at: earliest(sameDay.started_at, row.started_at),
    ended_at: latest(sameDay.ended_at, row.ended_at),
    status: (STATUS_RANK[sameDay.status] ?? 1) >= (STATUS_RANK[row.status] ?? 1) ? sameDay.status : row.status,
  };
  await db.execute(
    "UPDATE sessions SET uid = $1, started_at = $2, ended_at = $3, status = $4 WHERE id = $5",
    [merged.uid, merged.started_at, merged.ended_at, merged.status, sameDay.id],
  );
  const same =
    merged.uid === row.uid &&
    merged.started_at === row.started_at &&
    merged.ended_at === row.ended_at &&
    merged.status === row.status;
  if (same) await markApplied("sessions", row.uid, at, 0, peerId);
  else await markLocal("sessions", merged.uid, at);
}

/** The local id of an incoming row's session, by uid, else by its day
 *  (the uid may have lost a merge to this device's). */
async function localSessionId(change: SyncChange): Promise<number | null> {
  const uid = change.row?.session_uid;
  if (typeof uid === "string") {
    const byUid = await readSession("uid", uid);
    if (byUid) return byUid.id;
  }
  if (change.session) {
    const byDay = await readSession("date", change.session.row.date);
    if (byDay) return byDay.id;
  }
  return null;
}

function sameValues(a: Record<string, unknown>, b: Record<string, unknown>, cols: string[]): boolean {
  return cols.every((c) => (a[c] ?? null) === (b[c] ?? null));
}

async function applyRow(change: SyncChange, peerId: string): Promise<boolean> {
  const spec = TABLES[change.t];
  const db = await getDb();
  const row = change.row ?? {};

  if (change.session) await applySession(change.session.row, change.session.at, peerId);
  if (await localIsNewer(change.t, change.k, change.at)) return false;

  const values: Record<string, unknown> = {};
  for (const c of [...spec.pk, ...spec.cols]) values[c] = row[c] ?? null;
  if (spec.session) {
    const sessionId = await localSessionId(change);
    if (sessionId === null && spec.session === "required") return false;
    values.session_id = sessionId;
  }

  const existing = await readRow(change.t, change.k);
  const compared = [...spec.cols, ...(spec.session ? ["session_id"] : [])];
  if (existing && sameValues(existing, values, compared)) {
    await markApplied(change.t, change.k, change.at, 0, peerId);
    return false;
  }

  const cols = Object.keys(values);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = cols.filter((c) => !spec.pk.includes(c)).map((c) => `${c} = excluded.${c}`);
  const sql =
    `INSERT INTO ${change.t} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) ` +
    `ON CONFLICT(${spec.pk.join(", ")}) DO UPDATE SET ${updates.join(", ")}`;
  try {
    await db.execute(sql, cols.map((c) => values[c]));
  } catch (e) {
    // A note imported on both devices from the same file: same external_id,
    // different uid. Keep the note, drop the duplicate marker.
    if (change.t !== "captures" || values.external_id == null) throw e;
    values.external_id = null;
    await db.execute(sql, cols.map((c) => values[c]));
  }
  await markApplied(change.t, change.k, change.at, 0, peerId);
  return true;
}

async function applyDelete(change: SyncChange, peerId: string): Promise<boolean> {
  if (await localIsNewer(change.t, change.k, change.at)) return false;
  const spec = TABLES[change.t];
  const db = await getDb();
  if (change.t === "sessions") {
    const mine = await readSession("uid", change.k);
    if (mine && (await sessionInUse(mine.id))) return false;
  }
  await db.execute(`DELETE FROM ${change.t} WHERE ${pkSql(spec)} = $1`, [change.k]);
  await markApplied(change.t, change.k, change.at, 1, peerId);
  return true;
}

function dayOf(change: SyncChange): string | null {
  const row = change.row ?? {};
  if (typeof row.date === "string") return row.date.slice(0, 10);
  if (typeof row.created_at === "string" && change.t === "captures") return row.created_at.slice(0, 10);
  if (change.session) return change.session.row.date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(change.k)) return change.k;
  return null;
}

/** Writes a peer's changes here. Safe to repeat: a change already applied
 *  is recognised and skipped. With `resetAt`, changes from before that reset
 *  are dropped, except notes, which arrive as unjournaled notes. */
export async function applyChanges(
  changes: SyncChange[],
  peerId: string,
  opts: { resetAt?: string } = {},
): Promise<ApplyResult> {
  const tables = new Set<string>();
  const dates = new Set<string>();
  const known = changes
    .filter((c) => TABLES[c.t])
    .flatMap((c): SyncChange[] => {
      if (!opts.resetAt || c.at > opts.resetAt) return [c];
      if (c.t !== "captures" || c.del || !c.row) return [];
      return [{ ...c, session: null, row: { ...c.row, session_uid: null } }];
    });
  const rank = (c: SyncChange) => {
    // Sessions first, deleted sessions last (after whatever used them moved).
    if (c.t === "sessions") return c.del ? TABLE_ORDER.length : 0;
    return TABLE_ORDER.indexOf(c.t);
  };
  const ordered = known.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);

  for (const { c } of ordered) {
    let changed: boolean;
    if (c.t === "sessions" && !c.del && c.row) {
      await applySession(c.row as unknown as SessionRow, c.at, peerId);
      changed = true;
    } else if (c.del) {
      changed = await applyDelete(c, peerId);
    } else {
      changed = await applyRow(c, peerId);
    }
    if (changed) {
      tables.add(c.t);
      const day = dayOf(c);
      if (day) dates.add(day);
    }
  }
  return { tables: [...tables], dates: [...dates] };
}

// ---------- peers ----------

export async function getPeer(peerId: string): Promise<SyncPeer | null> {
  const db = await getDb();
  const rows = await db.select<SyncPeer[]>("SELECT * FROM sync_peers WHERE peer_id = $1", [peerId]);
  return rows[0] ?? null;
}

export async function listSyncPeers(): Promise<SyncPeer[]> {
  const db = await getDb();
  return db.select<SyncPeer[]>("SELECT * FROM sync_peers ORDER BY name");
}

export async function savePeer(peerId: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO sync_peers (peer_id, name) VALUES ($1, $2)
     ON CONFLICT(peer_id) DO UPDATE SET name = excluded.name`,
    [peerId, name],
  );
}

export async function savePeerProgress(
  peerId: string,
  progress: { sentRev?: number; receivedRev?: number },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sync_peers SET
       sent_rev = COALESCE($1, sent_rev),
       received_rev = COALESCE($2, received_rev),
       last_sync_at = $3
     WHERE peer_id = $4`,
    [progress.sentRev ?? null, progress.receivedRev ?? null, new Date().toISOString(), peerId],
  );
}

/** Pairing again starts from nothing, so every row is offered once more,
 *  including ones that first came from that device. */
export async function forgetPeer(peerId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM sync_peers WHERE peer_id = $1", [peerId]);
  await db.execute("UPDATE sync_changes SET origin = NULL WHERE origin = $1", [peerId]);
}

/**
 * After a backup is restored. Its sync records describe the day of the
 * backup, so a paired device's later reset would erase the restored journal
 * again at every sync. Forgetting them makes the next sync a fresh start:
 * both journals are offered in full and merged, the newest change winning,
 * and no earlier reset applies.
 */
export async function markJournalRestored(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM sync_peers");
  await db.execute("UPDATE sync_changes SET origin = NULL");
}

// ---------- resets ----------

const REV_MARKER = "_marker";
const key = (table: string, pk: string) => `${table}|${pk}`;

/** When the journal was last reset, here or on a paired device; "" if never. */
export async function getResetAt(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM sync_state WHERE key = 'reset_at'");
  return rows[0]?.value ?? "";
}

async function setResetAt(at: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO sync_state (key, value) VALUES ('reset_at', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [at],
  );
}

/** Drops logged changes, keeping `keep` and a marker of the highest revision
 *  so revisions keep rising and the peer's place in them stays valid. */
async function trimLog(keep: Set<string>): Promise<void> {
  const db = await getDb();
  const rev = await currentRev();
  const logged = await db.select<{ tbl: string; pk: string; deleted: number }[]>("SELECT tbl, pk, deleted FROM sync_changes");
  for (const c of logged) {
    if (c.tbl === REV_MARKER) continue;
    if (c.deleted || !keep.has(key(c.tbl, c.pk))) {
      await db.execute("DELETE FROM sync_changes WHERE tbl = $1 AND pk = $2", [c.tbl, c.pk]);
    }
  }
  await db.execute(
    `INSERT OR REPLACE INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
     VALUES ($1, 'rev', $2, $3, 1, NULL)`,
    [REV_MARKER, rev, nowUtc()],
  );
}

/** Call right after erasing the journal here, so the reset reaches paired
 *  devices at their next sync instead of row-by-row deletions. */
export async function recordLocalReset(): Promise<void> {
  await trimLog(new Set());
  await setResetAt(nowUtc());
}

/**
 * Resets this device when a paired device reports a newer reset. Only a
 * reset made after the two last synced counts: pairing with a device that
 * was reset long before must not erase this one. Kept: rows changed after
 * that reset, and notes written here that the other device never received
 * (logged here after `peerSeenRev`), which lose their session and wait as
 * unjournaled notes. Returns whether a reset happened.
 */
export async function applyRemoteReset(
  resetAt: string | undefined,
  peerSeenRev: number,
  peerId: string,
): Promise<boolean> {
  if (!resetAt || resetAt <= (await getResetAt())) return false;
  const lastSync = (await getPeer(peerId))?.last_sync_at;
  if (!lastSync || lastSync >= resetAt) return false;
  const db = await getDb();
  const keptRows = await db.select<{ tbl: string; pk: string }[]>(
    `SELECT tbl, pk FROM sync_changes
      WHERE deleted = 0
        AND (changed_at > $1 OR (tbl = 'captures' AND origin IS NULL AND rev > $2))`,
    [resetAt, peerSeenRev],
  );
  const keep = new Set(keptRows.map((r) => key(r.tbl, r.pk)));

  // Kept notes let go of sessions that are about to go.
  const notes = await db.select<{ uid: string; session_uid: string | null }[]>(
    "SELECT c.uid AS uid, s.uid AS session_uid FROM captures c LEFT JOIN sessions s ON s.id = c.session_id",
  );
  for (const n of notes) {
    if (keep.has(key("captures", n.uid)) && n.session_uid && !keep.has(key("sessions", n.session_uid))) {
      await db.execute("UPDATE captures SET session_id = NULL WHERE uid = $1", [n.uid]);
    }
  }

  for (const table of [...TABLE_ORDER.filter((t) => t !== "sessions"), "sessions"]) {
    const spec = TABLES[table];
    const rows = await db.select<{ pk: string; id?: number }[]>(
      `SELECT ${pkSql(spec)} AS pk${table === "sessions" ? ", id" : ""} FROM ${table}`,
    );
    for (const r of rows) {
      if (keep.has(key(table, r.pk))) continue;
      if (table === "settings" && r.pk === "lan_enabled") continue; // this computer's phone sync switch
      if (table === "sessions" && r.id !== undefined && (await sessionInUse(r.id))) continue;
      await db.execute(`DELETE FROM ${table} WHERE ${pkSql(spec)} = $1`, [r.pk]);
    }
  }
  // The notes that just let go of their sessions were logged again; keep those.
  const relinked = await db.select<{ pk: string }[]>(
    "SELECT pk FROM sync_changes WHERE tbl = 'captures' AND deleted = 0 AND changed_at > $1",
    [resetAt],
  );
  for (const r of relinked) keep.add(key("captures", r.pk));
  await trimLog(keep);
  await setResetAt(resetAt);
  return true;
}

// ---------- one sync round ----------
// The phone asks (prepareSyncRequest), the computer answers
// (answerSyncRequest), the phone takes the answer (finishSyncRound).

/** A peer's changes from before our reset are stale only if it last synced
 *  before that reset; a device paired afterwards has never seen it. */
function staleBefore(lastSync: string | null, resetAt: string): string | undefined {
  return lastSync && resetAt && lastSync < resetAt ? resetAt : undefined;
}

export interface SyncRequest {
  since: number;
  limit: number;
  changes: SyncChange[];
  resetAt: string;
}

export interface SyncReply extends SyncBatch {
  resetAt: string;
  /** The answering device had no record of the asker (new pairing, or its
   *  journal was restored): the asker should offer everything again. */
  fresh?: boolean;
}

export interface PreparedSync {
  request: SyncRequest;
  /** Our revision the peer had received before this round. */
  sentRev: number;
  upTo: number;
  more: boolean;
}

export async function prepareSyncRequest(peerId: string, limit = 200): Promise<PreparedSync> {
  const peer = await getPeer(peerId);
  const sentRev = peer?.sent_rev ?? 0;
  const out = await collectChanges(sentRev, peerId, limit);
  return {
    request: { since: peer?.received_rev ?? 0, limit, changes: out.changes, resetAt: await getResetAt() },
    sentRev,
    upTo: out.upTo,
    more: out.more,
  };
}

/**
 * Forget that these changes came from this peer.
 *
 * `origin` exists so a change is not echoed straight back to whoever wrote it.
 * It is a permanent tag, but "you wrote it" is only evidence that you STILL
 * HAVE it while the pairing holds. When a device is reinstalled, cleared or
 * restored, it loses rows it originally wrote — and because they are tagged
 * with its own id, neither side will ever offer them again. The rows exist on
 * one device, are wanted on the other, and are invisible to the sync forever.
 *
 * Found on a real pairing: three journal entries written on the phone had
 * reached the PC, the phone was reinstalled, and the PC would not give them
 * back (error.txt, 2026-09-22).
 *
 * So the moment we learn a peer has nothing of ours, we drop its tags and the
 * ordinary `rev > since` rule takes over.
 */
async function forgetPeerOrigin(peerId: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sync_changes SET origin = NULL WHERE origin = $1", [peerId]);
}

export async function answerSyncRequest(
  peerId: string,
  peerName: string,
  request: Partial<SyncRequest>,
): Promise<{ reply: SyncReply; applied: ApplyResult; reset: boolean }> {
  const known = await getPeer(peerId);
  await savePeer(peerId, peerName);
  const lastSync = known?.last_sync_at ?? null;
  // No record of this device: it gets everything, whatever it says it has.
  const since = known ? Number(request.since) || 0 : 0;
  // We know it, and yet it has received nothing of ours: it was reinstalled,
  // cleared or restored. Anything it once sent us is tagged with its id and
  // would be withheld; it needs that back more than anyone.
  if (known && since === 0) await forgetPeerOrigin(peerId);
  const reset = await applyRemoteReset(request.resetAt, since, peerId);
  const resetAt = await getResetAt();
  const applied = await applyChanges(Array.isArray(request.changes) ? request.changes : [], peerId, {
    resetAt: staleBefore(lastSync, resetAt),
  });
  const batch = await collectChanges(since, peerId, Math.min(Number(request.limit) || 300, 500));
  await savePeerProgress(peerId, {});
  return { reply: { ...batch, resetAt, fresh: !known }, applied, reset };
}

export async function finishSyncRound(
  peerId: string,
  prepared: PreparedSync,
  reply: Partial<SyncReply>,
): Promise<{ applied: ApplyResult; reset: boolean; more: boolean }> {
  const lastSync = (await getPeer(peerId))?.last_sync_at ?? null;
  // A device with no record of us can't reset us or hold our changes back.
  const reset = reply.fresh ? false : await applyRemoteReset(reply.resetAt, prepared.sentRev, peerId);
  const applied = await applyChanges(reply.changes ?? [], peerId, {
    resetAt: reply.fresh ? undefined : staleBefore(lastSync, await getResetAt()),
  });
  if (reply.fresh && prepared.sentRev > 0) {
    // It lost what we had sent (its journal was restored): send it all again,
    // including whatever it wrote itself before losing it.
    await forgetPeerOrigin(peerId);
    await savePeerProgress(peerId, { sentRev: 0, receivedRev: Number(reply.upTo) || 0 });
    return { applied, reset, more: true };
  }
  await savePeerProgress(peerId, { sentRev: prepared.upTo, receivedRev: Number(reply.upTo) || 0 });
  return { applied, reset, more: prepared.more || Boolean(reply.more) };
}
