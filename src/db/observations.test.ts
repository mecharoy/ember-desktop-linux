import { beforeEach, describe, expect, it, vi } from "vitest";
import { addTrackedHabit, pinHabit, rebuildObservations } from "./observations";

// A real SQLite database in memory, built from the app's own migrations.
const h = vi.hoisted(() => {
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

function seedHabitDay(date: string, key: string) {
  h.db
    .prepare("INSERT INTO day_metrics (date, mood, energy, raw_json) VALUES (?, 5, 5, ?)")
    .run(date, JSON.stringify({ habits: [{ key, done: true }] }));
}

const pinned = () =>
  h.db.prepare("SELECT key, pinned, occurrences FROM observations WHERE kind = 'habit'").all().map((r: object) => ({ ...r }));

const withDetail = () =>
  h.db.prepare("SELECT key, detail FROM observations WHERE kind = 'habit'").all().map((r: object) => ({ ...r }));

describe("pinHabit", () => {
  it("pins a habit the observations table hasn't caught up with yet", async () => {
    seedHabitDay("2026-09-10", "Doomscrolling");
    seedHabitDay("2026-09-11", "doomscrolling");
    expect(pinned()).toEqual([]);

    await pinHabit("doomscrolling");

    expect(pinned()).toEqual([{ key: "Doomscrolling", pinned: 1, occurrences: 2 }]);
  });

  it("pins an existing observation without rebuilding, whatever the case", async () => {
    h.db.exec(
      "INSERT INTO observations (kind, key, occurrences, first_seen, last_seen) VALUES ('habit', 'Gym', 7, '2026-09-01', '2026-09-12')",
    );
    await pinHabit("  gym ");
    expect(pinned()).toEqual([{ key: "Gym", pinned: 1, occurrences: 7 }]);
  });

  it("says so when the habit isn't in any entry", async () => {
    await expect(pinHabit("juggling")).rejects.toThrow("No habit");
  });
});

describe("addTrackedHabit", () => {
  it("saves the description on a brand-new habit", async () => {
    await addTrackedHabit("walk after lunch", "2026-09-18", "A 10-minute walk after lunch, most days.");
    expect(withDetail()).toEqual([{ key: "walk after lunch", detail: "A 10-minute walk after lunch, most days." }]);
  });

  it("fills in the description on a habit spotted in entries but not yet described", async () => {
    seedHabitDay("2026-09-10", "Doomscrolling");
    await addTrackedHabit("doomscrolling", "2026-09-18", "Less phone right before bed.");
    expect(withDetail()).toEqual([{ key: "Doomscrolling", detail: "Less phone right before bed." }]);
  });

  it("doesn't overwrite a description the habit already has", async () => {
    h.db.exec(
      "INSERT INTO observations (kind, key, detail, occurrences, first_seen, last_seen, pinned) VALUES ('habit', 'Gym', 'Original note', 7, '2026-09-01', '2026-09-12', 0)",
    );
    await addTrackedHabit("gym", "2026-09-18", "New description");
    expect(withDetail()).toEqual([{ key: "Gym", detail: "Original note" }]);
  });

  it("trims the description even when called directly, not just from the UI", async () => {
    await addTrackedHabit("walk after lunch", "2026-09-18", "  A 10-minute walk.  ");
    expect(withDetail()).toEqual([{ key: "walk after lunch", detail: "A 10-minute walk." }]);
  });
});

describe("rebuildObservations", () => {
  it("preserves a description on a habit that also appears in entries", async () => {
    seedHabitDay("2026-09-10", "Doomscrolling");
    await addTrackedHabit("doomscrolling", "2026-09-18", "Less phone right before bed.");
    expect(withDetail()).toEqual([{ key: "Doomscrolling", detail: "Less phone right before bed." }]);

    await rebuildObservations();

    expect(withDetail()).toEqual([{ key: "Doomscrolling", detail: "Less phone right before bed." }]);
  });

  it("preserves a description on a habit added from a suggestion that hasn't shown up in an entry yet", async () => {
    await addTrackedHabit("walk after lunch", "2026-09-18", "A 10-minute walk after lunch.");
    expect(withDetail()).toEqual([{ key: "walk after lunch", detail: "A 10-minute walk after lunch." }]);

    await rebuildObservations();

    expect(withDetail()).toEqual([{ key: "walk after lunch", detail: "A 10-minute walk after lunch." }]);
  });
});
