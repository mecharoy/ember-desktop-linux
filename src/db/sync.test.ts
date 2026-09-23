import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerSyncRequest,
  collectChanges,
  finishSyncRound,
  getPeer,
  getResetAt,
  markJournalRestored,
  prepareSyncRequest,
  recordLocalReset,
  savePeer,
  savePeerProgress,
} from "./sync";

// Two real in-memory databases built from the app's migrations: "pc" and
// "phone". getDb() answers with whichever one is current.
const h = vi.hoisted(() => {
  function bind(sql: string, params: unknown[]): Record<string, unknown> {
    const named: Record<string, unknown> = {};
    for (const m of new Set(sql.match(/\$\d+/g) ?? [])) named[m] = params[Number(m.slice(1)) - 1];
    return named;
  }
  return { dbs: {} as Record<string, any>, current: "pc", bind };
});

vi.mock("./client", () => ({
  getDb: async () => {
    const db = h.dbs[h.current];
    return {
      select: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(h.bind(sql, params)),
      execute: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(h.bind(sql, params)),
    };
  },
}));

const migrations = import.meta.glob("../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

beforeEach(async () => {
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule);
  for (const name of ["pc", "phone"]) {
    h.dbs[name] = new DatabaseSync(":memory:");
    for (const file of Object.keys(migrations).sort()) h.dbs[name].exec(migrations[file]);
  }
  h.current = "pc";
});

function on<T>(device: "pc" | "phone", fn: () => T): T {
  h.current = device;
  return fn();
}

function run(device: "pc" | "phone", sql: string, ...args: unknown[]) {
  return h.dbs[device].prepare(sql).run(...args);
}

function all(device: "pc" | "phone", sql: string, ...args: unknown[]) {
  return h.dbs[device].prepare(sql).all(...args).map((r: object) => ({ ...r }));
}

/** One full sync the way the apps run it: the phone asks, the PC answers.
 *  Returns which sides were reset by it. */
async function syncRound() {
  const resets = { pc: false, phone: false };
  h.current = "phone";
  await savePeer("pc-id", "PC");
  for (let i = 0; i < 20; i++) {
    h.current = "phone";
    const prepared = await prepareSyncRequest("pc-id", 5);
    // The request travels as JSON, like over the network.
    const request = JSON.parse(JSON.stringify(prepared.request));
    h.current = "pc";
    const answer = await answerSyncRequest("phone-id", "Phone", request);
    resets.pc ||= answer.reset;
    h.current = "phone";
    const done = await finishSyncRound("pc-id", prepared, JSON.parse(JSON.stringify(answer.reply)));
    resets.phone ||= done.reset;
    if (!done.more) return resets;
  }
  throw new Error("sync did not settle");
}

/** Erases a device's journal the way Settings > Reset Elytra does. */
async function reset(device: "pc" | "phone") {
  for (const t of ["messages", "captures", "entries", "day_metrics", "observations", "weekly_reviews", "monthly_reports",
    "assessments", "memory_summaries", "profile", "documents", "checkins", "habit_prefs", "sessions", "reminders"]) {
    run(device, `DELETE FROM ${t}`);
  }
  run(device, "DELETE FROM settings WHERE key <> 'lan_enabled'");
  await on(device, () => recordLocalReset());
}

const tick = () => new Promise((r) => setTimeout(r, 5));

/** A backup file of a device's journal, as Settings > Back up now writes it. */
async function backup(device: "pc" | "phone"): Promise<string> {
  const osModule = "node:os";
  const pathModule = "node:path";
  const { tmpdir } = await import(/* @vite-ignore */ osModule);
  const { join } = await import(/* @vite-ignore */ pathModule);
  const file = join(tmpdir(), `ember-sync-test-${device}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  h.dbs[device].exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** Puts a backup in place of a device's journal, as Restore backup does. */
async function restore(device: "pc" | "phone", file: string) {
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule);
  h.dbs[device] = new DatabaseSync(file);
  await on(device, () => markJournalRestored());
}

describe("sync", () => {
  it("copies each side's journal to the other, notes and messages under the right day", async () => {
    const pcSession = run("pc", "INSERT INTO sessions (date, status) VALUES ('2026-09-01', 'wrapped')").lastInsertRowid;
    run("pc", "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'from pc', '2026-09-01T21:00:00')", pcSession);
    run(
      "pc",
      `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, created_at)
       VALUES (?, '2026-09-01', 'T', 'N', '[]', 'C', '2026-09-01T22:00:00')`,
      pcSession,
    );
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-02T09:00:00', 'phone note')");
    run("phone", "INSERT INTO settings (key, value) VALUES ('user_name', 'Asha'), ('provider', 'pc')");

    await syncRound();

    expect(all("phone", "SELECT content FROM messages")).toEqual([{ content: "from pc" }]);
    expect(all("phone", "SELECT e.date, s.date AS session_date FROM entries e JOIN sessions s ON s.id = e.session_id")).toEqual([
      { date: "2026-09-01", session_date: "2026-09-01" },
    ]);
    expect(all("pc", "SELECT text FROM captures")).toEqual([{ text: "phone note" }]);
    expect(all("pc", "SELECT key, value FROM settings")).toEqual([{ key: "user_name", value: "Asha" }]);
  });

  it("merges the two sessions both devices made for the same day", async () => {
    const a = run("pc", "INSERT INTO sessions (date, status) VALUES ('2026-09-03', 'wrapped')").lastInsertRowid;
    run("pc", "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'pc', '2026-09-03T21:00:00')", a);
    const b = run("phone", "INSERT INTO sessions (date, status) VALUES ('2026-09-03', 'skipped')").lastInsertRowid;
    run("phone", "INSERT INTO captures (created_at, text, session_id) VALUES ('2026-09-03T08:00:00', 'n', ?)", b);

    await syncRound();
    await syncRound();

    for (const device of ["pc", "phone"] as const) {
      const sessions = all(device, "SELECT uid, status FROM sessions");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe("wrapped");
      expect(all(device, "SELECT COUNT(*) AS n FROM messages m JOIN sessions s ON s.id = m.session_id")).toEqual([{ n: 1 }]);
    }
    expect(all("pc", "SELECT uid FROM sessions")).toEqual(all("phone", "SELECT uid FROM sessions"));
  });

  it("lets the newest edit win and carries deletions", async () => {
    run("pc", "INSERT INTO checkins (date, mood, created_at, updated_at) VALUES ('2026-09-04', 5, 'x', 'x')");
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-04T10:00:00', 'gone soon')");
    await syncRound();

    await new Promise((r) => setTimeout(r, 5));
    run("phone", "UPDATE checkins SET mood = 8 WHERE date = '2026-09-04'");
    run("phone", "DELETE FROM captures");
    await syncRound();

    expect(all("pc", "SELECT mood FROM checkins")).toEqual([{ mood: 8 }]);
    expect(all("pc", "SELECT COUNT(*) AS n FROM captures")).toEqual([{ n: 0 }]);
  });

  it("carries the checklist, topics, day notes and writing style (migration 0013)", async () => {
    run("pc", "INSERT INTO checkins (date, day_notes, created_at, updated_at) VALUES ('2026-09-06', '{\"morning\":\"lab\"}', 'x', 'x')");
    run("pc", "INSERT INTO session_agendas (date, items, created_at, updated_at) VALUES ('2026-09-06', '[]', 'x', 'x')");
    run("pc", "INSERT INTO topics (key, title, first_seen, updated_at) VALUES ('dad', 'Dispute with Dad', '2026-09-06', 'x')");
    run("pc", "INSERT INTO settings (key, value) VALUES ('writing_style_sample', 'Short. Dry.'), ('provider', 'local')");
    await syncRound();

    expect(all("phone", "SELECT day_notes FROM checkins")).toEqual([{ day_notes: '{"morning":"lab"}' }]);
    expect(all("phone", "SELECT date FROM session_agendas")).toEqual([{ date: "2026-09-06" }]);
    expect(all("phone", "SELECT title FROM topics")).toEqual([{ title: "Dispute with Dad" }]);
    expect(all("phone", "SELECT key FROM settings ORDER BY key")).toEqual([{ key: "writing_style_sample" }]);
  });


  it("doesn't send changes back to the device they came from", async () => {
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-05T10:00:00', 'once')");
    await syncRound();
    const peer = await on("phone", () => getPeer("pc-id"));
    const echo = await on("phone", () => collectChanges(peer!.sent_rev, "pc-id"));
    expect(echo.changes).toEqual([]);
  });

  it("keeps a wrapped-up day wrapped when the other side marks it skipped", async () => {
    run("pc", "INSERT INTO sessions (date, status) VALUES ('2026-09-06', 'open')");
    await syncRound();
    await new Promise((r) => setTimeout(r, 5));
    run("pc", "UPDATE sessions SET status = 'wrapped'");
    await syncRound();
    await new Promise((r) => setTimeout(r, 5));
    run("phone", "UPDATE sessions SET status = 'skipped'");
    await syncRound();
    await syncRound();
    expect(all("pc", "SELECT status FROM sessions")).toEqual([{ status: "wrapped" }]);
    expect(all("phone", "SELECT status FROM sessions")).toEqual([{ status: "wrapped" }]);
  });

  it("moves an entry's day on the other device too", async () => {
    const sid = run("pc", "INSERT INTO sessions (date, status) VALUES ('2026-09-07', 'wrapped')").lastInsertRowid;
    run("pc", "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'hi', 'x')", sid);
    run(
      "pc",
      `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, created_at)
       VALUES (?, '2026-09-07', 'T', 'N', '[]', 'C', 'x')`,
      sid,
    );
    await syncRound();
    await new Promise((r) => setTimeout(r, 5));
    run("pc", "UPDATE sessions SET date = '2026-09-06' WHERE id = ?", sid);
    run("pc", "UPDATE entries SET date = '2026-09-06'");
    await syncRound();
    expect(all("phone", "SELECT date FROM sessions")).toEqual([{ date: "2026-09-06" }]);
    expect(all("phone", "SELECT date FROM entries")).toEqual([{ date: "2026-09-06" }]);
    expect(all("phone", "SELECT COUNT(*) AS n FROM messages")).toEqual([{ n: 1 }]);
  });

  it("resets the PC when the phone is reset, keeping the PC's unsynced notes", async () => {
    const sid = run("pc", "INSERT INTO sessions (date, status) VALUES ('2026-09-08', 'wrapped')").lastInsertRowid;
    run("pc", "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'old talk', 'x')", sid);
    run("pc", "INSERT INTO captures (created_at, text, session_id) VALUES ('2026-09-08T10:00:00', 'synced note', ?)", sid);
    run("pc", "INSERT INTO settings (key, value) VALUES ('user_name', 'Asha'), ('provider', 'local'), ('lan_enabled', '1')");
    await syncRound();
    await tick();

    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-09T09:00:00', 'pc note, not synced yet')");
    await reset("phone");
    await tick();
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-09T11:00:00', 'phone note after reset')");

    const resets = await syncRound();
    await syncRound();

    expect(resets).toEqual({ pc: true, phone: false });
    for (const device of ["pc", "phone"] as const) {
      expect(all(device, "SELECT text, session_id FROM captures ORDER BY text")).toEqual([
        { text: "pc note, not synced yet", session_id: null },
        { text: "phone note after reset", session_id: null },
      ]);
      expect(all(device, "SELECT COUNT(*) AS n FROM messages")).toEqual([{ n: 0 }]);
      expect(all(device, "SELECT COUNT(*) AS n FROM sessions")).toEqual([{ n: 0 }]);
    }
    expect(all("pc", "SELECT key FROM settings")).toEqual([{ key: "lan_enabled" }]);
    expect(await on("pc", () => getResetAt())).toBe(await on("phone", () => getResetAt()));
  });

  it("resets the phone when the PC is reset, keeping the phone's unsynced notes", async () => {
    run("phone", "INSERT INTO checkins (date, mood, created_at, updated_at) VALUES ('2026-09-10', 6, 'x', 'x')");
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-10T08:00:00', 'synced')");
    await syncRound();
    await tick();
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-10T09:00:00', 'phone leftover')");
    run("phone", "UPDATE checkins SET mood = 2");
    await tick();
    await reset("pc");

    const resets = await syncRound();
    await syncRound();

    expect(resets.phone).toBe(true);
    for (const device of ["pc", "phone"] as const) {
      expect(all(device, "SELECT text FROM captures")).toEqual([{ text: "phone leftover" }]);
      expect(all(device, "SELECT COUNT(*) AS n FROM checkins")).toEqual([{ n: 0 }]);
    }
  });

  it("doesn't let an old reset erase, or hold back, a journal paired later", async () => {
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-12T08:00:00', 'pc journal')");
    run("pc", "INSERT INTO checkins (date, mood, created_at, updated_at) VALUES ('2026-09-12', 7, 'x', 'x')");
    await tick();
    await reset("phone"); // after the PC's journal was written, before they ever paired
    await tick();
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-13T08:00:00', 'phone journal')");
    const resets = await syncRound();
    await syncRound();
    expect(resets).toEqual({ pc: false, phone: false });
    for (const device of ["pc", "phone"] as const) {
      expect(all(device, "SELECT text FROM captures ORDER BY text")).toEqual([{ text: "pc journal" }, { text: "phone journal" }]);
      expect(all(device, "SELECT mood FROM checkins")).toEqual([{ mood: 7 }]);
    }
  });

  it("keeps syncing normally after a reset", async () => {
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-11T08:00:00', 'before')");
    await syncRound();
    await tick();
    await reset("pc");
    await syncRound();
    await tick();
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-11T20:00:00', 'new on pc')");
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-11T21:00:00', 'new on phone')");
    await syncRound();
    for (const device of ["pc", "phone"] as const) {
      expect(all(device, "SELECT text FROM captures ORDER BY text")).toEqual([{ text: "new on pc" }, { text: "new on phone" }]);
    }
    const peer = await on("phone", () => getPeer("pc-id"));
    expect(await on("phone", () => collectChanges(peer!.sent_rev, "pc-id"))).toMatchObject({ changes: [] });
  });

  it("keeps a restored phone backup after a reset on the PC, and sends it over", async () => {
    run("phone", "INSERT INTO captures (created_at, text) VALUES ('2026-09-14T08:00:00', 'kept in the backup')");
    run("phone", "INSERT INTO checkins (date, mood, created_at, updated_at) VALUES ('2026-09-14', 8, 'x', 'x')");
    await syncRound();
    const file = await backup("phone");
    await tick();
    await reset("pc");
    await syncRound(); // the phone resets too
    expect(all("phone", "SELECT COUNT(*) AS n FROM captures")).toEqual([{ n: 0 }]);

    await restore("phone", file);
    const first = await syncRound();
    const second = await syncRound();

    expect(first).toEqual({ pc: false, phone: false });
    expect(second).toEqual({ pc: false, phone: false });
    for (const device of ["pc", "phone"] as const) {
      expect(all(device, "SELECT text FROM captures")).toEqual([{ text: "kept in the backup" }]);
      expect(all(device, "SELECT mood FROM checkins")).toEqual([{ mood: 8 }]);
    }
  });

  it("sends a restored PC backup to the phone in full", async () => {
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-14T09:00:00', 'pc backup note')");
    await syncRound();
    const file = await backup("pc");
    await tick();
    run("pc", "INSERT INTO captures (created_at, text) VALUES ('2026-09-14T10:00:00', 'written after the backup')");
    await syncRound();
    await tick();
    await reset("phone");
    await syncRound(); // the PC resets too

    await restore("pc", file);
    const resets = await syncRound();
    await syncRound();

    expect(resets).toEqual({ pc: false, phone: false });
    for (const device of ["pc", "phone"] as const) {
      expect(all(device, "SELECT text FROM captures")).toEqual([{ text: "pc backup note" }]);
    }
  });
  // Last on purpose: these tests share one pair of databases and run in order,
  // so a test that syncs extra rows shifts what the ones after it see.
  it("gives a device back what it wrote, once it has lost it", async () => {
    // The phone writes a day, it reaches the PC, and then the phone is
    // reinstalled: its journal is empty and it has acknowledged nothing. The
    // change is still tagged as having come from the phone, so without the
    // fresh-peer rule the PC would never offer it back and the day would be
    // gone for good. Found on a real pairing where three entries were stuck
    // exactly this way (error.txt, 2026-09-22).
    run("phone", "INSERT INTO sessions (date, status) VALUES ('2026-09-29', 'wrapped')");
    const sid = all("phone", "SELECT id FROM sessions WHERE date = '2026-09-29'")[0].id;
    run(
      "phone",
      `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, created_at)
       VALUES (${sid}, '2026-09-29', 'Tuesday', 'a day', '[]', '', '2026-09-29T21:00:00')`,
    );
    await syncRound();
    expect(all("pc", "SELECT date FROM entries WHERE date = '2026-09-29'")).toEqual([{ date: "2026-09-29" }]);

    // Now the phone is reinstalled: empty journal, empty change log, still
    // paired but holding nothing of the PC's. (Clearing the log too, because
    // a reinstall is not a delete — no tombstones should travel.)
    run("phone", "DELETE FROM entries");
    run("phone", "DELETE FROM sessions WHERE date = '2026-09-29'");
    run("phone", "DELETE FROM sync_changes");
    await on("phone", () => savePeerProgress("pc-id", { sentRev: 0, receivedRev: 0 }));

    await syncRound();
    expect(all("phone", "SELECT date FROM entries WHERE date = '2026-09-29'")).toEqual([{ date: "2026-09-29" }]);
  });
});