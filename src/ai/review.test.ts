import { describe, expect, it } from "vitest";
import {
  dueReviewWeek,
  mayRewriteProfile,
  reviewWithProvider,
  sourceDaysKey,
  WeeklyReviewSchema,
  type ExistingReview,
} from "./review";
import { buildReviewUserPrompt } from "./prompts/review";
import type { AIProvider, ChatMessage } from "./types";

const VALID = JSON.stringify({
  letter: "Dear Amy, this week had a clear center of gravity...",
  strengths: [{ claim: "You follow through for other people", evidence: "9 of 10 commitments mentioned were kept" }],
  focus_areas: [{ claim: "Short sleep may be dragging your mood", evidence: "4 of 5 low-mood days followed <6h sleep" }],
  new_profile_summary: "Amy is a PhD student...",
});

function stubProvider(responses: (string | Error)[]): { provider: AIProvider; prompts: string[] } {
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
        throw new Error("not used by the reviewer");
      },
    },
  };
}

const INPUT = {
  weekStart: "2026-06-29",
  weekEnd: "2026-07-05",
  days: [{ date: "2026-07-01", rawJson: '{"mood":6}' }],
  currentProfile: null,
  currentStrengths: "[]",
  currentFocusAreas: "[]",
  userName: "Amy",
};

const none: ExistingReview[] = [];
const reviewed = (weekStart: string, sourceDays: string | null = null): ExistingReview => ({ weekStart, sourceDays });

describe("dueReviewWeek", () => {
  it("waits on Sunday until Sunday's entry exists, then reviews the week", () => {
    // Sun 2026-07-12 closes the week of Mon 07-06. The old rule fired at
    // midnight, before the week's last day had been written.
    expect(dueReviewWeek("2026-07-12", ["2026-07-08"], none)).toBeNull();
    expect(dueReviewWeek("2026-07-12", ["2026-07-08", "2026-07-12"], none)).toBe("2026-07-06");
  });

  it("reviews a finished week from the Monday after, Sunday entry or not", () => {
    expect(dueReviewWeek("2026-07-13", ["2026-07-08"], none)).toBe("2026-07-06");
    expect(dueReviewWeek("2026-07-09", ["2026-07-01"], none)).toBe("2026-06-29");
  });

  it("returns null when everything reviewable is reviewed, or there's no data at all", () => {
    expect(dueReviewWeek("2026-07-09", ["2026-07-01"], [reviewed("2026-06-29")])).toBeNull();
    expect(dueReviewWeek("2026-07-09", [], none)).toBeNull();
  });

  it("backfills the oldest unreviewed week when the app missed several Sundays", () => {
    // data in the weeks of 06-08 and 06-29; app off for weeks — oldest first
    const dates = ["2026-06-10", "2026-07-01"];
    expect(dueReviewWeek("2026-07-09", dates, none)).toBe("2026-06-08");
    // once that week is reviewed, the next unreviewed one with data is due
    expect(dueReviewWeek("2026-07-09", dates, [reviewed("2026-06-08")])).toBe("2026-06-29");
    // dataless gap weeks (06-15, 06-22) are skipped, never reviewed
    expect(dueReviewWeek("2026-07-09", dates, [reviewed("2026-06-08"), reviewed("2026-06-29")])).toBeNull();
  });

  it("never reviews the in-progress week before Sunday", () => {
    expect(dueReviewWeek("2026-07-09", ["2026-07-08"], [reviewed("2026-06-29")])).toBeNull();
  });

  it("rewrites a review whose week gained a day after it was written", () => {
    const dates = ["2026-07-01", "2026-07-04"];
    expect(dueReviewWeek("2026-07-09", dates, [reviewed("2026-06-29", "2026-07-01")])).toBe("2026-06-29");
    expect(dueReviewWeek("2026-07-09", dates, [reviewed("2026-06-29", sourceDaysKey(dates))])).toBeNull();
  });

  it("leaves reviews from before source tracking alone", () => {
    expect(dueReviewWeek("2026-07-09", ["2026-07-01", "2026-07-04"], [reviewed("2026-06-29", null)])).toBeNull();
  });
});

describe("mayRewriteProfile", () => {
  it("lets only the newest week rewrite the profile, and not from a single day", () => {
    expect(mayRewriteProfile("2026-07-06", ["2026-06-29"], 3, true)).toBe(true);
    expect(mayRewriteProfile("2026-06-29", ["2026-07-06"], 3, true)).toBe(false); // rewriting an old week
    expect(mayRewriteProfile("2026-07-06", [], 1, true)).toBe(false); // one day can't overwrite a portrait
    expect(mayRewriteProfile("2026-07-06", [], 1, false)).toBe(true); // …but it can seed the first one
  });
});

describe("reviewWithProvider", () => {
  it("parses a valid review", async () => {
    const { provider } = stubProvider([VALID]);
    const result = await reviewWithProvider(provider, INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.review.strengths).toHaveLength(1);
  });

  it("retries once with the error appended, then degrades", async () => {
    const { provider, prompts } = stubProvider(["nope", "still nope"]);
    const result = await reviewWithProvider(provider, INPUT);
    expect(result.ok).toBe(false);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("could not be parsed");
  });

  it("accepts empty card lists (evidence-or-omit means zero claims is valid)", () => {
    const parsed = WeeklyReviewSchema.parse({ letter: "l", new_profile_summary: "p" });
    expect(parsed.strengths).toEqual([]);
    expect(parsed.focus_areas).toEqual([]);
  });

  it("gives a claim without dates an empty list, and rejects malformed dates", () => {
    const parsed = WeeklyReviewSchema.parse({
      letter: "l",
      new_profile_summary: "p",
      strengths: [{ claim: "c", evidence: "e" }],
    });
    expect(parsed.strengths[0].dates).toEqual([]);
    expect(() =>
      WeeklyReviewSchema.parse({
        letter: "l",
        new_profile_summary: "p",
        strengths: [{ claim: "c", evidence: "e", dates: ["last Tuesday"] }],
      }),
    ).toThrow();
  });
});

describe("buildReviewUserPrompt", () => {
  it("assembles the week, days, profile and standing cards (snapshot)", () => {
    expect(buildReviewUserPrompt(INPUT)).toMatchSnapshot();
  });
});
