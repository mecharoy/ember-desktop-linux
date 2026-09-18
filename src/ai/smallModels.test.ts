import { describe, expect, it } from "vitest";
import { budgetFor, conversationShares } from "./budget";
import { estimateTokens } from "./tokens";
import { clip, keywords, pickRelevant, splitLines } from "./relevance";
import { fitTranscript, windowStart } from "./window";
import { compactDayLine } from "./compactDays";
import { memoryFilesDue } from "./memoryFiles";
import { counselorCompactPrompt } from "./prompts/counselorCompact";
import { linkCandidates, formatCandidate } from "../insights/links";
import { SETTINGS_DEFAULTS } from "../db/settings";
import type { DayRow } from "../insights/stats";

const settings = (over: Record<string, string>) => ({ ...SETTINGS_DEFAULTS, ...over });

describe("budgetFor", () => {
  it("puts local, free hosted and the phone's computer link in compact mode", () => {
    expect(budgetFor(settings({ provider: "local", local_num_ctx: "8192" }))).toMatchObject({ mode: "compact", totalTokens: 8192 });
    expect(budgetFor(settings({ provider: "cloud" })).mode).toBe("compact");
    expect(budgetFor(settings({ provider: "pc" })).mode).toBe("compact");
    expect(budgetFor(settings({ provider: "anthropic" })).mode).toBe("full");
  });

  it("follows the setting when it forces a mode", () => {
    expect(budgetFor(settings({ provider: "local", context_mode: "full" })).mode).toBe("full");
    expect(budgetFor(settings({ provider: "openai", context_mode: "compact" })).mode).toBe("compact");
  });

  it("stays under a free tier's per-minute limit", () => {
    // Groq's preset: 8000 tokens a minute.
    expect(budgetFor(settings({ provider: "cloud", cloud_api_base: "https://api.groq.com/openai/v1/chat/completions" })).totalTokens).toBe(6400);
  });

  it("shares a small window between context and chat", () => {
    const s = conversationShares({ mode: "compact", totalTokens: 8192, replyTokens: 700 }, 1200);
    expect(s.context).toBeLessThanOrEqual(2200);
    expect(s.context + s.history).toBeLessThanOrEqual(8192 - 700 - 1200);
  });
});

describe("relevance", () => {
  it("marks names and drops filler words", () => {
    const k = keywords("Talked with Dad about the thesis today");
    expect(k.has("thesis")).toBe(true);
    expect(k.has("!dad")).toBe(false); // three letters: too short to match on
    expect(k.has("today")).toBe(false);
    expect(keywords("Priya called").has("!priya")).toBe(true);
  });

  it("keeps the lines that share words with today, within the budget", () => {
    const lines = [
      { source: "People", text: "Priya — lab partner, easy to work with" },
      { source: "People", text: "Grandma — calls on Sundays" },
      { source: "Goals", text: "Finish thesis chapter three by October" },
    ];
    const picked = pickRelevant(lines, "Long day in the lab with Priya, thesis chapter stalled", 200);
    expect(picked).toContain("Priya");
    expect(picked).toContain("thesis chapter");
    expect(picked).not.toContain("Grandma");
    expect(pickRelevant(lines, "nothing in common", 200)).toBe("(nothing that matches today)");
  });

  it("splits files and profiles into lines, and clips long text", () => {
    expect(splitLines("- one\n- two\nA sentence. Another One.")).toEqual(["one", "two", "A sentence.", "Another One."]);
    expect(clip("a\n".repeat(500), 20)).toContain("[…cut to fit]");
  });
});

describe("rolling window", () => {
  const chat = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: `message ${i} ${"word ".repeat(40)}` }));

  it("keeps the recent part, starting on one of their messages", () => {
    const history = chat(12);
    const start = windowStart(history, 200);
    expect(start).toBeGreaterThan(0);
    expect(history[start].role).toBe("user");
    expect(history.length - start).toBeGreaterThanOrEqual(2);
  });

  it("shortens Ember's lines first for background jobs, then falls back to the summary", () => {
    const t = [
      { role: "assistant" as const, content: "First sentence here. " + "More detail. ".repeat(60) },
      { role: "user" as const, content: "What I said" },
    ];
    const short = fitTranscript(t, 60);
    expect(short[0].content).toBe("First sentence here.");
    expect(short[1].content).toBe("What I said");
    const tiny = fitTranscript(chat(20), 80, "they talked about the lab");
    expect(tiny[0].content).toContain("they talked about the lab");
  });
});

describe("compactDayLine", () => {
  it("turns a day's record into one plain line", () => {
    const line = compactDayLine(
      JSON.stringify({
        mood: 4,
        energy: 3,
        sleep_hours: 5.5,
        summary_line: "Argued with Dad.",
        themes: [{ key: "family", sentiment: -0.7 }],
        habits: [{ key: "drinking", done: true }],
        people: [{ key: "Dad", sentiment: -0.5 }],
        emotions_named: ["hurt"],
      }),
    );
    expect(line).toBe("mood 4, energy 3, slept 5.5h. Argued with Dad. | themes: family− | habits: drinking ✓ | people: Dad− | felt: hurt");
    expect(estimateTokens(line)).toBeLessThan(60);
  });
});

describe("memory files", () => {
  const file = (updated: string) => ({ name: "people" as const, content: "", user_edited: 0 as const, updated_at: updated });
  it("are written the first time, then weekly while new entries come in", () => {
    expect(memoryFilesDue([file("")], "2026-09-10", "2026-09-17")).toBe(true);
    expect(memoryFilesDue([file("2026-09-12T20:00:00")], "2026-09-16", "2026-09-17")).toBe(false);
    expect(memoryFilesDue([file("2026-09-08T20:00:00")], "2026-09-16", "2026-09-17")).toBe(true);
    expect(memoryFilesDue([file("2026-09-08T20:00:00")], "2026-09-07", "2026-09-17")).toBe(false);
  });
});

describe("counted links", () => {
  const day = (date: string, drank: boolean, argued: boolean): DayRow => ({
    date,
    mood: argued ? 4 : 7,
    energy: 5,
    summaryLine: null,
    x: {
      themes: argued ? [{ key: "argument with dad", sentiment: -0.6 }] : [{ key: "thesis", sentiment: 0 }],
      habits: [{ key: "drinking", done: drank }],
      people: [],
      emotions: [],
      emotionsNamed: null,
      sleep_hours: null,
      moodSource: null,
      activities: [],
      thinkingTraps: [],
      rhythm: { firstContact: null, workStart: null, dinner: null },
    },
  });

  it("finds what shares a habit's days more than usual, with the numbers", () => {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const date = `2026-09-${String(i + 1).padStart(2, "0")}`;
      return day(date, i % 3 === 0, i % 3 === 0);
    });
    const links = linkCandidates(rows, ["drinking"]);
    const top = links[0];
    expect(top.with).toBe('theme "argument with dad"');
    expect(top.together).toBe(4);
    expect(formatCandidate(top)).toContain("4 of 4 drinking days");
  });
});

describe("counselorCompactPrompt", () => {
  const layers = {
    userName: "Amy",
    todayLine: "Thursday, 2026-07-09",
    style: { tone: "balanced" as const, approach: "therapist" as const },
    briefing: "- Talk with Dad went better",
    checkIn: "- mood: 6/10",
    dayParts: "1. waking up → now",
    notes: "- 14:02: lab ran late",
    memory: "People:\n- Dad — arguments about moving out",
  };

  it("carries the briefing and memory lines, the markers, and repeats the key rules at the end", () => {
    const p = counselorCompactPrompt(layers);
    for (const s of ["Talk with Dad went better", "arguments about moving out", "[[covered|ID]]", "[[write-journal]]", "REMEMBER:", "findahelpline.com"]) {
      expect(p).toContain(s);
    }
    expect(estimateTokens(p)).toBeLessThan(1400);
  });

  it("has no checklist in friend style", () => {
    expect(counselorCompactPrompt({ ...layers, style: { tone: "gentle", approach: "friend" } })).not.toContain("[[covered|");
  });
});
