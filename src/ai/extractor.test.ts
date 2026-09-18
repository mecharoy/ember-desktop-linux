import { describe, expect, it } from "vitest";
import { applyCheckIn, ExtractionSchema, extractWithProvider, groundExtraction } from "./extractor";
import type { AIProvider, ChatMessage } from "./types";

const VALID = JSON.stringify({
  mood: 6,
  energy: 4,
  summary_line: "Draining vendor conflict, redeemed by a strong gym session.",
  themes: [{ key: "vendor conflict", sentiment: -0.6 }],
  habits: [{ key: "gym", done: true }],
  people: [{ key: "Priya", sentiment: 0.3 }],
  emotions: ["frustrated", "proud"],
  sleep_hours: 6.5,
  strengths_shown: ["held boundary in a hard conversation"],
  struggles_shown: ["ruminating after work hours"],
});

const INPUT = {
  date: "2026-07-09",
  entry: {
    title: "Vendor day",
    narrative: "A day.",
    highlights: ["gym"],
    counselorNote: "note",
  },
  transcript: [{ role: "user" as const, content: "rough day" }],
};

/** Provider stub returning canned responses in order, recording prompts. */
function stubProvider(responses: (string | Error)[]): {
  provider: AIProvider;
  prompts: string[];
} {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    provider: {
      async complete(messages: ChatMessage[]): Promise<string> {
        prompts.push(messages[messages.length - 1].content);
        const r = responses[Math.min(i++, responses.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
      async *chatStream(): AsyncIterable<string> {
        throw new Error("not used by the extractor");
      },
    },
  };
}

describe("extractWithProvider", () => {
  it("parses a valid response on the first attempt", async () => {
    const { provider, prompts } = stubProvider([VALID]);
    const result = await extractWithProvider(provider, INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extraction.mood).toBe(6);
      expect(result.extraction.habits).toEqual([{ key: "gym", done: true }]);
    }
    expect(prompts).toHaveLength(1);
  });

  it("accepts JSON wrapped in a markdown fence", async () => {
    const { provider } = stubProvider(["```json\n" + VALID + "\n```"]);
    const result = await extractWithProvider(provider, INPUT);
    expect(result.ok).toBe(true);
  });

  it("retries exactly once, appending the parse error to the prompt", async () => {
    const { provider, prompts } = stubProvider(["this is not json", VALID]);
    const result = await extractWithProvider(provider, INPUT);
    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("could not be parsed");
  });

  it("degrades to { ok: false } after two failures — never throws", async () => {
    const { provider, prompts } = stubProvider(['{"mood": "eleven"}']);
    const result = await extractWithProvider(provider, INPUT);
    expect(result.ok).toBe(false);
    expect(prompts).toHaveLength(2);
  });

  it("treats provider errors like parse failures (retry, then degrade)", async () => {
    const { provider, prompts } = stubProvider([new Error("network down")]);
    const result = await extractWithProvider(provider, INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("network down");
    expect(prompts).toHaveLength(2);
  });
});

describe("ExtractionSchema", () => {
  it("defaults missing lists to empty and missing numbers to null", () => {
    const x = ExtractionSchema.parse({});
    expect(x.mood).toBeNull();
    expect(x.energy).toBeNull();
    expect(x.summary_line).toBeNull();
    expect(x.sleep_hours).toBeNull();
    expect(x.themes).toEqual([]);
    expect(x.habits).toEqual([]);
    expect(x.people).toEqual([]);
    expect(x.emotions).toEqual([]);
    expect(x.strengths_shown).toEqual([]);
    expect(x.struggles_shown).toEqual([]);
  });

  it("rejects out-of-range values instead of storing garbage", () => {
    expect(() => ExtractionSchema.parse({ mood: 14 })).toThrow();
    expect(() => ExtractionSchema.parse({ themes: [{ key: "x", sentiment: 2 }] })).toThrow();
    expect(() => ExtractionSchema.parse({ sleep_hours: 30 })).toThrow();
  });

  it("defaults the user's own emotion words to empty", () => {
    expect(ExtractionSchema.parse({}).emotions_named).toEqual([]);
  });
});

describe("applyCheckIn", () => {
  const x = ExtractionSchema.parse(JSON.parse(VALID));

  it("marks the mood as the AI's when there is no check-in", () => {
    const stored = applyCheckIn(x, null);
    expect(stored.mood).toBe(6);
    expect(stored.mood_source).toBe("ai");
  });

  it("lets the user's own answers beat the model's reading", () => {
    const stored = applyCheckIn(x, {
      mood: 3,
      energy: null,
      sleepHours: 5,
      feeling: "drained, restless",
      onMind: null,
      habits: { Gym: false, reading: true },
      bedtime: null,
      wakeTime: null,
      sleepLatencyMin: null,
      sleepQuality: null,
      lunch: null,
      eveningBreak: null,
      dinner: null,
      dayNotes: {},
    });
    expect(stored.mood).toBe(3);
    expect(stored.mood_source).toBe("user");
    expect(stored.energy).toBe(4); // left blank in the form → model's value stays
    expect(stored.sleep_hours).toBe(5);
    expect(stored.habits).toEqual([
      { key: "Gym", done: false }, // the form's answer replaces "gym: done" from the text
      { key: "reading", done: true },
    ]);
    expect(stored.emotions_named).toEqual(["drained", "restless"]);
  });
});

describe("new fields (activities, thinking traps, routine)", () => {
  it("fall back instead of failing the whole day when a model fumbles them", () => {
    const x = ExtractionSchema.parse({
      ...JSON.parse(VALID),
      activities: "went for a walk", // not a list
      thinking_traps: [{ type: "catastrophising" }], // no quote
      rhythm: { first_contact: "around nine", work_start: "09:15", dinner: null },
    });
    expect(x.mood).toBe(6); // the rest of the day survives
    expect(x.activities).toEqual([]);
    expect(x.thinking_traps).toEqual([]);
    expect(x.rhythm).toEqual({ first_contact: null, work_start: "09:15", dinner: null });
  });

  it("are empty on an older response that has none of them", () => {
    const x = ExtractionSchema.parse(JSON.parse(VALID));
    expect(x.activities).toEqual([]);
    expect(x.thinking_traps).toEqual([]);
    expect(x.rhythm).toEqual({ first_contact: null, work_start: null, dinner: null });
  });

  it("keep only thinking traps the user actually said, never Ember's words", () => {
    const x = ExtractionSchema.parse({
      ...JSON.parse(VALID),
      thinking_traps: [
        { type: "catastrophising", quote: "the whole project is doomed" },
        { type: "labelling", quote: "you called yourself lazy" },
        { type: "fortune_telling", quote: "it'll go badly tomorrow" },
      ],
    });
    const grounded = groundExtraction(
      x,
      [
        { role: "user", content: "Honestly the whole project is doomed." },
        { role: "assistant", content: "Earlier you called yourself lazy — say more?" },
      ],
      { mood: null, energy: null, sleepHours: null, feeling: null, onMind: "it'll go badly tomorrow", habits: {}, bedtime: null, wakeTime: null, sleepLatencyMin: null, sleepQuality: null, lunch: null, eveningBreak: null, dinner: null, dayNotes: {} },
    );
    expect(grounded.thinking_traps.map((t) => t.type)).toEqual(["catastrophising", "fortune_telling"]);
  });
});
