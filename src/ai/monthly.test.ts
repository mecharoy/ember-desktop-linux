import { describe, expect, it } from "vitest";
import { dueReportMonth, groundFormulation, monthlyWithProvider, parseFormulation, previousMonth } from "./monthly";
import { buildMonthlyUserPrompt } from "./prompts/monthly";
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
      async *chatStream(): AsyncIterable<string> {
        throw new Error("not used by the monthly reviewer");
      },
    },
  };
}

const INPUT = {
  userName: "Amy",
  stats: {
    month: "2026-08",
    daysJournaled: 9,
    avgMood: 6.2,
    avgEnergy: 5.1,
    topTheme: { key: "exam prep", count: 5 },
    bestWeek: { weekStart: "2026-08-17", avgMood: 7.3, days: 3 },
  },
  previous: null,
  days: [{ date: "2026-08-03", rawJson: '{"mood":6}' }],
};

describe("previousMonth", () => {
  it("steps back one month, across a year boundary too", () => {
    expect(previousMonth("2026-09")).toBe("2026-08");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("dueReportMonth", () => {
  it("never reports on the month still in progress", () => {
    expect(dueReportMonth("2026-09-11", ["2026-09-01"], [])).toBeNull();
  });

  it("reports a finished month with data, oldest first", () => {
    const dates = ["2026-07-20", "2026-08-03", "2026-09-01"];
    expect(dueReportMonth("2026-09-11", dates, [])).toBe("2026-07");
    expect(dueReportMonth("2026-09-11", dates, [{ month: "2026-07", sourceDays: "2026-07-20" }])).toBe("2026-08");
  });

  it("rewrites a report whose month gained a day, and is quiet otherwise", () => {
    const dates = ["2026-08-03", "2026-08-30"];
    expect(dueReportMonth("2026-09-11", dates, [{ month: "2026-08", sourceDays: "2026-08-03" }])).toBe("2026-08");
    expect(dueReportMonth("2026-09-11", dates, [{ month: "2026-08", sourceDays: "2026-08-03,2026-08-30" }])).toBeNull();
  });
});

describe("monthlyWithProvider", () => {
  it("parses a valid report and retries once on a bad one", async () => {
    const good = JSON.stringify({ letter: "Dear Amy…", changed: "You journaled twice as often." });
    const ok = await monthlyWithProvider(stubProvider([good]).provider, INPUT);
    expect(ok.ok).toBe(true);

    const { provider, prompts } = stubProvider(["nope", good]);
    const retried = await monthlyWithProvider(provider, INPUT);
    expect(retried.ok).toBe(true);
    expect(prompts[1]).toContain("could not be parsed");
  });

  it("hands the model the app's numbers to quote", () => {
    const prompt = buildMonthlyUserPrompt(INPUT);
    expect(prompt).toContain("average mood: 6.2 / 10");
    expect(prompt).toContain("best week: week of 2026-08-17, average mood 7.3 over 3 days");
    expect(prompt).toContain("(no previous month recorded)");
  });
});

describe("formulation (the 5 Ps)", () => {
  it("survives a report that has none, as an empty formulation", async () => {
    const { provider } = stubProvider([JSON.stringify({ letter: "A month.", changed: "Less rain." })]);
    const r = await monthlyWithProvider(provider, {
      userName: "Sam",
      stats: { month: "2026-08", daysJournaled: 3, avgMood: 6, avgEnergy: 5, topTheme: null, bestWeek: null },
      previous: null,
      days: [],
    });
    expect(r.ok && r.report.formulation.presenting).toEqual([]);
  });

  it("keeps only points tied to days of that month, capped at four", () => {
    const f = groundFormulation(
      {
        presenting: [
          { point: "Exam stress", dates: ["2026-08-03", "2026-08-03", "2026-09-01"] },
          { point: "No evidence", dates: ["2026-07-30"] },
        ],
        predisposing: [],
        precipitating: [],
        perpetuating: Array.from({ length: 6 }, (_, i) => ({ point: `p${i}`, dates: ["2026-08-04"] })),
        protective: [{ point: "  ", dates: ["2026-08-03"] }],
      },
      ["2026-08-03", "2026-08-04"],
    );
    expect(f.presenting).toEqual([{ point: "Exam stress", dates: ["2026-08-03"] }]);
    expect(f.perpetuating).toHaveLength(4);
    expect(f.protective).toEqual([]);
  });

  it("reads a stored formulation back, treating an empty one as none", () => {
    expect(parseFormulation(null)).toBeNull();
    expect(parseFormulation("not json")).toBeNull();
    expect(parseFormulation(JSON.stringify({ presenting: [], predisposing: [], precipitating: [], perpetuating: [], protective: [] }))).toBeNull();
    expect(parseFormulation(JSON.stringify({ presenting: [{ point: "x", dates: ["2026-08-01"] }] }))?.presenting).toHaveLength(1);
  });

  it("gives the model questionnaire totals, never item answers", () => {
    const prompt = buildMonthlyUserPrompt({
      userName: "Sam",
      stats: { month: "2026-08", daysJournaled: 3, avgMood: 6, avgEnergy: 5, topTheme: null, bestWeek: null },
      previous: null,
      days: [],
      assessments: [{ instrument: "phq9", date: "2026-08-10", score: 7 }],
    });
    expect(prompt).toContain("PHQ-9 7/27 (mild)");
  });
});
