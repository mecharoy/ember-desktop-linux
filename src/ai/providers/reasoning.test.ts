import { describe, expect, it } from "vitest";
import { createReasoningFilter, stripReasoning } from "./reasoning";

/** Feeds chunks through the filter the way a stream would. */
function stream(chunks: string[]): string {
  const filter = createReasoningFilter();
  return chunks.map((c) => filter.push(c)).join("") + filter.flush();
}

describe("stripReasoning", () => {
  it("drops a think block and keeps the answer", () => {
    expect(stripReasoning("<think>Let me see. The user said hi.</think>Hey Abhi.")).toBe("Hey Abhi.");
  });

  it("drops several blocks and leaves text between them", () => {
    expect(stripReasoning("A<think>x</think>B<think>y</think>C")).toBe("ABC");
  });

  it("drops a block the reply never closed, rather than showing the thought", () => {
    expect(stripReasoning("<think>I should ask about Saturday")).toBe("");
  });

  it("leaves an ordinary reply alone", () => {
    expect(stripReasoning("Hey Abhi. Saturday evenings are quieter.")).toBe("Hey Abhi. Saturday evenings are quieter.");
  });
});

describe("createReasoningFilter", () => {
  it("holds back a tag split across chunks", () => {
    expect(stream(["<th", "ink>plan", "ning</thi", "nk>Hey."])).toBe("Hey.");
  });

  it("emits text before the block as it arrives", () => {
    const filter = createReasoningFilter();
    expect(filter.push("Hey. ")).toBe("Hey. ");
    expect(filter.push("<think>hm</think>")).toBe("");
    expect(filter.push("Saturday?")).toBe("Saturday?");
  });

  it("does not swallow a lone angle bracket", () => {
    expect(stream(["1 < 2", " and 3 > 2"])).toBe("1 < 2 and 3 > 2");
  });
});
