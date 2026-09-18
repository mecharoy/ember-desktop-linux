import { describe, expect, it } from "vitest";
import { extractCovered, formatAgendaForPreamble, markCovered, nextItemId } from "./agenda";
import { parseAgendaItems } from "../db/agendas";
import type { AgendaItem } from "../db/types";

const items: AgendaItem[] = [
  { id: "p1", section: "past", text: "The talk with Dad", state: "open", topic: "dispute-with-dad" },
  { id: "t1", section: "today", text: "The lab mess", state: "open" },
  { id: "f1", section: "future", text: "Friday's exam", state: "skip" },
];

describe("checklist markers", () => {
  it("strips covered markers and returns their ids", () => {
    const { clean, ids } = extractCovered("That sounds like it settled something.\n\n[[covered|P1]]\n[[covered | t1]]");
    expect(clean).toBe("That sounds like it settled something.");
    expect(ids).toEqual(["p1", "t1"]);
  });

  it("leaves a reply without markers untouched", () => {
    expect(extractCovered("Plain reply  ")).toEqual({ clean: "Plain reply  ", ids: [] });
  });

  it("ticks open items off but never un-crosses a skipped one", () => {
    const next = markCovered(items, ["t1", "f1", "zz"]);
    expect(next.map((i) => i.state)).toEqual(["open", "done", "skip"]);
  });

  it("shows crossed-out items as such to the counselor", () => {
    expect(formatAgendaForPreamble(items)).toContain("f1 (future, crossed out): Friday's exam");
  });

  it("gives an added item a fresh id in its section", () => {
    expect(nextItemId(items, "today")).toBe("t2");
    expect(nextItemId([...items, { id: "t2", section: "today", text: "x", state: "open" }], "today")).toBe("t3");
  });
});

describe("parseAgendaItems", () => {
  it("drops malformed items and repairs unknown sections and states", () => {
    const parsed = parseAgendaItems(
      JSON.stringify([{ id: "a", text: "ok", section: "someday", state: "maybe" }, { id: 3, text: "bad" }, { id: "b", text: " " }]),
    );
    expect(parsed).toEqual([{ id: "a", section: "today", text: "ok", state: "open", topic: null }]);
    expect(parseAgendaItems("not json")).toEqual([]);
  });
});
