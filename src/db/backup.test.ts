import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeBackup } from "./backup";

vi.mock("./client", () => ({ getDb: vi.fn(), withStagedBackup: vi.fn() }));

const migrations = import.meta.glob("../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

let db: any;

async function freshDb(withSchema: boolean) {
  const sqliteModule = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule);
  db = new DatabaseSync(":memory:");
  if (withSchema) for (const file of Object.keys(migrations).sort()) db.exec(migrations[file]);
}

const reader = {
  select: async <T,>(sql: string) => db.prepare(sql).all() as T,
};

beforeEach(() => freshDb(true));

describe("summarizeBackup", () => {
  it("counts entries and notes, finds the latest day and the name", async () => {
    db.exec("INSERT INTO settings (key, value) VALUES ('user_name', 'Abhi')");
    const sid = Number(db.prepare("INSERT INTO sessions (date, status) VALUES ('2026-09-10', 'wrapped')").run().lastInsertRowid);
    db.prepare(
      `INSERT INTO entries (session_id, date, title, narrative, highlights, counselor_note, created_at)
       VALUES (?, '2026-09-10', 'T', 'N', '[]', 'C', '2026-09-10T22:00:00')`,
    ).run(sid);
    db.exec("INSERT INTO captures (created_at, text) VALUES ('2026-09-12T08:30:00', 'later note')");
    db.exec("INSERT INTO captures (created_at, text) VALUES ('2026-09-09T08:30:00', 'earlier note')");

    expect(await summarizeBackup(reader)).toEqual({ name: "Abhi", entries: 1, notes: 2, lastDay: "2026-09-12" });
  });

  it("handles a journal with nothing in it yet", async () => {
    expect(await summarizeBackup(reader)).toEqual({ name: "", entries: 0, notes: 0, lastDay: null });
  });

  it("says plainly when the file isn't an Ember journal", async () => {
    await freshDb(false);
    await expect(summarizeBackup(reader)).rejects.toThrow("isn't an Ember backup");
  });
});
