import { describe, expect, it } from "vitest";
import {
  dueFortnight,
  formatJournalsSince,
  formatSummaryForPrompt,
  fortnightNumbers,
  fortnightWithProvider,
} from "./fortnightly";
import { buildFortnightUserPrompt } from "./prompts/fortnightly";
import { addDays } from "../insights/stats";
import type { AIProvider, ChatMessage } from "./types";

function stubProvider(responses: string[]): { provider: AIProvider; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    provider: {
      async complete(messages: ChatMessage[]): Promise<string> {
        prompts.push(messages[messages.length - 1].content);
        return responses[Math.min(i++, responses.length - 1)];
      },
      async *chatStream() {
        yield "";
      },
    },
  };
}

const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

describe("dueFortnight", () => {
  it("waits until the fortnight from the oldest unsummarised entry is over", () => {
    const entries = days("2026-09-01", 10);
    expect(dueFortnight("2026-09-14", entries, [])).toBeNull(); // 09-01..09-14 still running
    expect(dueFortnight("2026-09-15", entries, [])).toEqual({ number: 1, dates: entries });
  });

  it("takes only that fortnight, and numbers on from the last summary", () => {
    const entries = days("2026-08-01", 40);
    const first = { number: 1, source_days: days("2026-08-01", 14).join(",") };
    const due = dueFortnight("2026-09-30", entries, [first]);
    expect(due?.number).toBe(2);
    expect(due?.dates).toEqual(days("2026-08-15", 14));
  });

  it("never folds in today, and is quiet when everything is covered", () => {
    const entries = days("2026-09-01", 15); // includes 09-15
    const s = { number: 1, source_days: days("2026-09-01", 14).join(",") };
    expect(dueFortnight("2026-09-15", entries, [s])).toBeNull();
  });

  it("picks up a late entry dated inside an already summarised fortnight", () => {
    const covered = days("2026-08-01", 14).filter((d) => d !== "2026-08-05");
    const s = { number: 1, source_days: covered.join(",") };
    const entries = [...covered, "2026-08-05"]; // written up afterwards
    expect(dueFortnight("2026-09-01", entries, [s])).toEqual({ number: 2, dates: ["2026-08-05"] });
  });
});

describe("formatJournalsSince", () => {
  const entries = [
    { date: "2026-09-01", title: "One", narrative: "First." },
    { date: "2026-09-02", title: "Two", narrative: "Second." },
    { date: "2026-09-03", title: "Three", narrative: "Third." },
  ];

  it("gives every uncovered entry before the day, oldest first", () => {
    const text = formatJournalsSince(entries, [{ source_days: "2026-09-01" }], "2026-09-03");
    expect(text).toBe("2026-09-02 — Two\nSecond.");
  });

  it("keeps the newest within the budget and names the rest", () => {
    const text = formatJournalsSince(entries, [], "2026-09-10", 40);
    expect(text).toContain("2 older entries not shown for space: 2026-09-01, 2026-09-02");
    expect(text).toContain("2026-09-03 — Three");
    expect(text).not.toContain("Second.");
  });

  it("says so when there is nothing new", () => {
    expect(formatJournalsSince([], [], "2026-09-10")).toBe("(none)");
  });
});

describe("formatSummaryForPrompt", () => {
  it("lays the sections out in a fixed order and skips empty ones", () => {
    const text = formatSummaryForPrompt({
      number: 3,
      period_start: "2026-08-01",
      period_end: "2026-08-14",
      summary: JSON.stringify({
        overview: "Two busy weeks.",
        life_context: "",
        patterns: "Worry spikes before deadlines.",
        mood_and_energy: "Mood 5.8 on average.",
        threads: [{ thread: "Thesis chapter", status: "worsening", note: "behind plan", dates: ["2026-08-10"] }],
        open_loops: ["Email the supervisor"],
        follow_up: [],
      }),
    });
    expect(text).toBe(
      [
        "Summary #3, covering entries from 2026-08-01 to 2026-08-14.",
        "Overview: Two busy weeks.",
        "Mood and energy: Mood 5.8 on average.",
        "Patterns noticed: Worry spikes before deadlines.",
        "Ongoing threads:",
        "- [worsening] Thesis chapter — behind plan (2026-08-10)",
        "Open loops:",
        "- Email the supervisor",
      ].join("\n"),
    );
  });
});

describe("fortnightWithProvider", () => {
  const input = {
    userName: "Sam",
    number: 2,
    previous: "Summary #1, covering entries from 2026-08-01 to 2026-08-14.\nOverview: Settling in.",
    numbers: { from: "2026-08-15", to: "2026-08-28", entries: 2, avgMood: 6.5, avgEnergy: null, avgSleepHours: 7.25 },
    entries: [{ date: "2026-08-15", title: "Back at work", narrative: "Long day.", highlights: ["lunch with Priya"], summaryLine: null }],
    assessments: [{ instrument: "who5" as const, date: "2026-08-20", score: 15 }],
  };

  it("hands over the previous summary, the numbers and the new entries", () => {
    const prompt = buildFortnightUserPrompt(input);
    expect(prompt).toContain("THIS IS SUMMARY #2");
    expect(prompt).toContain("Overview: Settling in.");
    expect(prompt).toContain("average mood: 6.5 / 10");
    expect(prompt).toContain("average sleep: 7.3 h");
    expect(prompt).toContain("WHO-5 Well-Being Index 60/100 (fine)");
    expect(prompt).toContain("### 2026-08-15 — Back at work");
  });

  it("parses a valid summary, falls back on a bad status, and retries once on bad JSON", async () => {
    const good = JSON.stringify({ overview: "Steady.", threads: [{ thread: "Job hunt", status: "stalled" }] });
    const { provider, prompts } = stubProvider(["not json", good]);
    const r = await fortnightWithProvider(provider, input);
    expect(prompts).toHaveLength(2);
    expect(r.ok && r.summary.threads[0].status).toBe("ongoing");
    expect(r.ok && r.summary.relationships).toBe("");
  });
});

describe("fortnightNumbers", () => {
  it("averages only the period's rated days", () => {
    const n = fortnightNumbers(["2026-08-02", "2026-08-01"], [
      { date: "2026-08-01", mood: 6, energy: null, summary_line: null, raw_json: JSON.stringify({ sleep_hours: 7 }) },
      { date: "2026-08-02", mood: 4, energy: 5, summary_line: null, raw_json: "{}" },
      { date: "2026-08-03", mood: 1, energy: 1, summary_line: null, raw_json: "{}" },
    ]);
    expect(n).toEqual({ from: "2026-08-01", to: "2026-08-02", entries: 2, avgMood: 5, avgEnergy: 5, avgSleepHours: 7 });
  });
});
