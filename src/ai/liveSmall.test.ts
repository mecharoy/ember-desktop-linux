// Live check of the compact prompts against a real small model in Ollama.
// EMBER_LIVE_OLLAMA=qwen3.5:4b npx vitest run src/ai/liveSmall.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { prepSystemPrompt } from "./prepare";
import { counselorCompactPrompt } from "./prompts/counselorCompact";
import { EXTRACT_DAY_SYSTEM_PROMPT, EXTRACT_PERSON_SYSTEM_PROMPT, buildExtractCompactPrompt } from "./prompts/extractorCompact";
import { mergeCompactParts } from "./extractor";
import { extractJson } from "./json";
import { stripReasoning } from "./providers/reasoning";

// The app's TypeScript settings have no Node types; these tests run in Node.
declare const process: { env: Record<string, string | undefined> };

const model = process.env.EMBER_LIVE_OLLAMA;
const live = model ? describe : describe.skip;

async function chat(system: string, user: string, numPredict = 700): Promise<{ text: string; seconds: number }> {
  const t0 = Date.now();
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { num_ctx: 8192, num_predict: numPredict },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const json = (await res.json()) as { message?: { content?: string } };
  return { text: stripReasoning(json.message?.content ?? ""), seconds: (Date.now() - t0) / 1000 };
}

const checkIn = `- mood: 5/10
- energy: 4/10
- feeling, in their words: "tired, a bit tense"
- on their mind: "the call with Dad"
- what they did, waking up → lunch, in their words: "lab work, the centrifuge broke again"`;
const notes = "- 11:02: centrifuge broke, lost the morning's samples\n- 17:40: called Dad, didn't argue this time";

live("compact prompts on a small local model", () => {
  it("prepares a briefing and checklist as valid JSON", async () => {
    const material = `THE DAY: Thursday, 2026-09-17

THEIR CHECK-IN:
${checkIn}

TODAY'S NOTES:
${notes}

FROM EMBER'S MEMORY OF THEM (the lines that match today):
People:
- Dad — arguments about moving out; calls often end badly
Topics you are working through:
- [dispute-with-dad] Dispute with Dad: they argue about moving out. Next: whether the Thursday call happened

Return the JSON now.`;
    const { text, seconds } = await chat(prepSystemPrompt(true, "therapist"), material, 600);
    console.log(`PREP (${seconds}s):\n${text}`);
    const parsed = z
      .object({ briefing: z.string().min(1), past: z.array(z.object({ text: z.string() })).default([]), today: z.array(z.object({ text: z.string() })).default([]) })
      .parse(extractJson(text));
    expect(parsed.briefing.length).toBeGreaterThan(20);
  }, 300_000);

  it("reads an entry in two parts that both validate", async () => {
    const input = {
      date: "2026-09-17",
      entry: {
        title: "Samples lost, Dad found",
        narrative: "The centrifuge broke before noon and I lost the morning's samples. I sat there for an hour. In the evening I called Dad and for once we didn't argue about the move.",
        highlights: ["A calm call with Dad"],
        counselorNote: "",
      },
      transcript: [],
      knownNames: { themes: ["lab work", "family"], habits: ["gym"], people: ["Dad"], activities: [] },
      dismissedHabits: [],
      checkIn,
    };
    const prompt = buildExtractCompactPrompt(input, "- Lost everything from the morning. I'm useless at this.\n- Dad was actually nice today.");
    const a = await chat(EXTRACT_DAY_SYSTEM_PROMPT, prompt);
    const b = await chat(EXTRACT_PERSON_SYSTEM_PROMPT, prompt);
    console.log(`DAY (${a.seconds}s):\n${a.text}\n\nPERSON (${b.seconds}s):\n${b.text}`);
    const merged = mergeCompactParts(
      extractJson(a.text) as Record<string, unknown>,
      extractJson(b.text) as Record<string, unknown>,
      "Lost everything from the morning. I'm useless at this.\nDad was actually nice today.\n" + checkIn,
    );
    console.log("MERGED emotions_named:", merged.emotions_named, "habits:", JSON.stringify(merged.habits));
    expect(merged.mood).toBe(5);
    expect(merged.emotions_named.every((w) => w.split(" ").length <= 3)).toBe(true);
  }, 300_000);

  it("opens the conversation with one question", async () => {
    const system = counselorCompactPrompt({
      userName: "Abhi",
      todayLine: "Thursday, 2026-09-17",
      style: { tone: "balanced", approach: "therapist" },
      briefing: "- Lost the morning's samples; tense since.\n- Called Dad and didn't argue: a first in weeks.\n- Start with the call with Dad.",
      checkIn,
      dayParts: "1. waking up → lunch (13:10)\n2. lunch (13:10) → now",
      notes,
      memory: "People:\n- Dad — arguments about moving out",
    });
    const { text, seconds } = await chat(
      system,
      "[SESSION STATE — from the app, not from them: the time right now is 21:15; you are 0 exchanges into this conversation; their length preference is standard — around 8-10 exchanges. Today's checklist: \n  p1 (past, open): Whether the call with Dad happened\n  t1 (today, open): The lost samples]\n\nLet's begin today's conversation.",
      300,
    );
    console.log(`FIRST REPLY (${seconds}s):\n${text}`);
    expect((text.match(/\?/g) ?? []).length).toBeLessThanOrEqual(2);
  }, 300_000);
});
