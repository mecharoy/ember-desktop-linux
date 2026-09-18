import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteEntry, moveEntry } from "./entries";
import { deleteReviewsWithoutDays } from "./reviews";
import { listUnjournaledCaptures } from "./captures";
import { conversationState, listUnwrittenConversationDays, restartConversation } from "./sessions";

// A real SQLite database in memory, built from the app's own migrations, so
// these run the exact statements the app runs — never against ember.db.
const h = vi.hoisted(() => {
  // tauri-plugin-sql takes $1, $2... as positional; node:sqlite sees them as
  // named parameters, so bind them by name.
  function bind(sql: string, params: unknown[]): Record<string, unknown> {
    const named: Record<string, unknown> = {};
    for (const m of new Set(sql.match(/\$\d+/g) ?? [])) named[m] = params[Number(m.slice(1)) - 1];
    return named;
  }
  return { db: null as any, bind };
});

vi.mock("./client", () => ({
  getDb: async () => ({
    select: async (sql: string, params: unknown[] = []) => h.db.prepare(sql).all(h.bind(sql, params)),
    execute: async (sql: string, params: unknown[] = []) => h.db.prepare(sql).run(h.bind(sql, params)),
  }),
}));

const migrations = import.meta.glob("../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

beforeEach(async () => {
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule);
  h.db = new DatabaseSync(":memory:");
  for (const file of Object.keys(migrations).sort()) h.db.exec(migrations[file]);
});

function run(sql: string, ...args: unknown[]) {
  return h.db.prepare(sql).run(...args);
}

function count(table: string, where = "1", ...args: unknown[]): number {
  return Number(h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n);
}

/** A fully journaled day: conversation, a note, entry, extracted numbers, check-in. */
function seedJournaledDay(date: string): number {
  const sid = Number(run("INSERT INTO sessions (date, status) VALUES (?, 'wrapped')", date).lastInsertRowid);
  run("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'hi', ?)", sid, `${date}T21:00:00`);
  run("INSERT INTO captures (created_at, text, session_id) VALUES (?, ?, ?)", `${date}T12:00:00`, `note ${date}`, sid);
  run(
    `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, created_at)
     VALUES (?, ?, 'T', 'N', '[]', 'C', ?)`,
    sid,
    date,
    `${date}T22:00:00`,
  );
  run("INSERT INTO day_metrics (date, mood, energy, raw_json) VALUES (?, 6, 5, ?)", date, JSON.stringify({ mood: 6 }));
  run("INSERT INTO checkins (date, mood, created_at, updated_at) VALUES (?, 7, ?, ?)", date, `${date}T20:00:00`, `${date}T20:00:00`);
  return sid;
}

describe("deleteEntry", () => {
  it("removes the entry and its numbers, keeps the conversation, check-in and notes", async () => {
    seedJournaledDay("2026-09-01");
    await deleteEntry("2026-09-01");

    expect(count("entries")).toBe(0);
    expect(count("day_metrics")).toBe(0);
    expect(count("sessions")).toBe(1);
    expect(count("messages")).toBe(1);
    expect(count("checkins")).toBe(1);
    // With no entry on its session, the note is waiting to be journaled again.
    expect((await listUnjournaledCaptures("2026-09-12")).map((c) => c.text)).toEqual(["note 2026-09-01"]);
  });

  it("leaves other days alone", async () => {
    seedJournaledDay("2026-09-01");
    seedJournaledDay("2026-09-02");
    await deleteEntry("2026-09-01");

    expect(count("entries", "date = ?", "2026-09-02")).toBe(1);
    expect(count("day_metrics", "date = ?", "2026-09-02")).toBe(1);
  });
});

describe("moveEntry", () => {
  it("moves the entry with its conversation, numbers and check-in", async () => {
    const sid = seedJournaledDay("2026-09-02");
    expect(await moveEntry("2026-09-02", "2026-09-01")).toEqual({ ok: true });

    for (const table of ["entries", "sessions", "day_metrics", "checkins"]) {
      expect(count(table, "date = ?", "2026-09-02")).toBe(0);
      expect(count(table, "date = ?", "2026-09-01")).toBe(1);
    }
    expect(count("sessions", "id = ? AND date = ?", sid, "2026-09-01")).toBe(1);
    expect(count("messages", "session_id = ?", sid)).toBe(1);
    expect(await listUnjournaledCaptures("2026-09-12")).toEqual([]);
  });

  it("takes the place of an empty skipped-day marker", async () => {
    run("INSERT INTO sessions (date, status) VALUES ('2026-09-01', 'skipped')");
    const sid = seedJournaledDay("2026-09-02");
    expect(await moveEntry("2026-09-02", "2026-09-01")).toEqual({ ok: true });

    expect(count("sessions", "date = ?", "2026-09-01")).toBe(1);
    expect(count("sessions", "date = ? AND id = ?", "2026-09-01", sid)).toBe(1);
  });

  it("refuses a date that already has an entry, and changes nothing", async () => {
    seedJournaledDay("2026-09-01");
    seedJournaledDay("2026-09-02");
    const result = await moveEntry("2026-09-02", "2026-09-01");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/already has an entry/);
    for (const table of ["entries", "sessions", "day_metrics", "checkins"]) {
      expect(count(table, "date = ?", "2026-09-01")).toBe(1);
      expect(count(table, "date = ?", "2026-09-02")).toBe(1);
    }
  });

  it("refuses a date with a check-in", async () => {
    run("INSERT INTO checkins (date, created_at, updated_at) VALUES ('2026-09-01', 'x', 'x')");
    seedJournaledDay("2026-09-02");

    expect((await moveEntry("2026-09-02", "2026-09-01")).ok).toBe(false);
    expect(count("entries", "date = ?", "2026-09-02")).toBe(1);
  });

  it("refuses a date with a conversation", async () => {
    const other = Number(run("INSERT INTO sessions (date, status) VALUES ('2026-09-01', 'open')").lastInsertRowid);
    run("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'hey', 'x')", other);
    seedJournaledDay("2026-09-02");

    expect((await moveEntry("2026-09-02", "2026-09-01")).ok).toBe(false);
    expect(count("entries", "date = ?", "2026-09-02")).toBe(1);
  });

  it("refuses future dates and missing entries", async () => {
    seedJournaledDay("2026-09-02");
    expect((await moveEntry("2026-09-02", "2999-01-01")).ok).toBe(false);
    expect((await moveEntry("2026-08-01", "2026-08-02")).ok).toBe(false);
    expect(count("entries", "date = ?", "2026-09-02")).toBe(1);
  });
});

/** A session with n messages and no entry: talked about, not written up. */
function seedConversation(date: string, status: string, n: number): number {
  const sid = Number(run("INSERT INTO sessions (date, status) VALUES (?, ?)", date, status).lastInsertRowid);
  for (let i = 0; i < n; i++) {
    run("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', 'm', 'x')", sid);
  }
  return sid;
}

describe("moveEntry after midnight", () => {
  it("moves an entry back onto its own conversation's day", async () => {
    // The evening's session is dated the 11th; the entry was saved after
    // midnight, so it is dated the 12th.
    const evening = seedConversation("2026-09-11", "wrapped", 3);
    run("INSERT INTO checkins (date, created_at, updated_at) VALUES ('2026-09-11', 'x', 'x')");
    run(
      `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, created_at)
       VALUES (?, '2026-09-12', 'T', 'N', '[]', 'C', 'x')`,
      evening,
    );
    // The 12th has its own short session and check-in, which stay where they are.
    const next = seedConversation("2026-09-12", "open", 2);
    run("INSERT INTO checkins (date, created_at, updated_at) VALUES ('2026-09-12', 'x', 'x')");

    expect(await moveEntry("2026-09-12", "2026-09-11")).toEqual({ ok: true });
    expect(count("entries", "date = ? AND session_id = ?", "2026-09-11", evening)).toBe(1);
    expect(count("sessions", "id = ? AND date = ?", next, "2026-09-12")).toBe(1);
    expect(count("checkins", "date = ?", "2026-09-11")).toBe(1);
    expect(count("checkins", "date = ?", "2026-09-12")).toBe(1);
  });

  it("says why when the day has a conversation of its own", async () => {
    seedConversation("2026-09-11", "skipped", 18);
    seedJournaledDay("2026-09-12");
    const result = await moveEntry("2026-09-12", "2026-09-11");
    expect(!result.ok && result.reason).toMatch(/never written up/);
  });
});

describe("restartConversation", () => {
  it("clears the messages and reopens the day, keeping the check-in, notes and entry", async () => {
    const sid = seedJournaledDay("2026-09-05");
    run("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'assistant', 'evening', ?)", sid, "2026-09-05T21:01:00");

    await restartConversation(sid);

    expect(count("messages")).toBe(0);
    expect(count("captures")).toBe(1);
    expect(count("checkins")).toBe(1);
    expect(count("entries")).toBe(1); // a written entry is not undone by starting over
    const session = h.db.prepare("SELECT status, ended_at FROM sessions WHERE id = ?").get(sid);
    expect(session.status).toBe("open");
    expect(session.ended_at).toBe(null);
    expect(await conversationState("2026-09-05")).toBe("none");
  });

  it("touches only the day it is given", async () => {
    const keep = seedJournaledDay("2026-09-06");
    const wipe = seedJournaledDay("2026-09-07");

    await restartConversation(wipe);

    expect(count("messages", "session_id = ?", keep)).toBe(1);
    expect(count("messages", "session_id = ?", wipe)).toBe(0);
  });
});

describe("unwritten conversations", () => {
  it("lists days talked about but never written up, and only those", async () => {
    seedJournaledDay("2026-09-10"); // written up
    seedConversation("2026-09-11", "skipped", 18); // talked, never written
    seedConversation("2026-09-12", "open", 1); // only the hidden kickoff
    expect(await listUnwrittenConversationDays()).toEqual([{ date: "2026-09-11", messages: 18 }]);
  });

  it("tells an unfinished conversation from a finished one", async () => {
    const sid = seedConversation("2026-09-11", "open", 4);
    expect(await conversationState("2026-09-11")).toBe("unfinished");
    run("UPDATE sessions SET status = 'wrapped' WHERE id = ?", sid);
    expect(await conversationState("2026-09-11")).toBe("done");
    expect(await conversationState("2026-09-13")).toBe("none");
  });
});

describe("deleteReviewsWithoutDays", () => {
  it("drops reviews whose week or month has no days left, and only those", async () => {
    run("INSERT INTO day_metrics (date, raw_json) VALUES ('2026-08-25', '{}')");
    const weekly = (week: string, days: string | null) =>
      run(
        `INSERT INTO weekly_reviews (week_start, letter, strengths, focus_areas, created_at, source_days)
         VALUES (?, 'L', '[]', '[]', 'x', ?)`,
        week,
        days,
      );
    weekly("2026-08-31", "2026-09-01"); // its only day was deleted
    weekly("2026-08-24", "2026-08-25"); // still has its day
    weekly("2026-08-17", null); // written before source_days existed: left alone
    const monthly = (month: string) =>
      run(
        `INSERT INTO monthly_reports (month, letter, changed, stats, source_days, created_at)
         VALUES (?, 'L', 'C', '{}', '', 'x')`,
        month,
      );
    monthly("2026-07");
    monthly("2026-08");

    await deleteReviewsWithoutDays();

    const weeks = h.db.prepare("SELECT week_start FROM weekly_reviews ORDER BY week_start").all();
    expect(weeks.map((r: { week_start: string }) => r.week_start)).toEqual(["2026-08-17", "2026-08-24"]);
    const months = h.db.prepare("SELECT month FROM monthly_reports").all();
    expect(months.map((r: { month: string }) => r.month)).toEqual(["2026-08"]);
  });
});
