// Picks the memory lines that matter today, for small models that can't take
// all of it: each line scores by the words it shares with today's material
// (notes, check-in, checklist), names count double, and the best lines are
// kept until the budget is used. Pure — unit-tested in relevance.test.ts.

import { estimateTokens } from "./tokens";

export interface MemoryLine {
  /** Which file or layer it came from, e.g. "People". */
  source: string;
  text: string;
  /** Added to the score: lines worth keeping even without a match. */
  base?: number;
}

const STOP = new Set(
  (
    "about after again also always been before being both could didn't does doing done down each even every from " +
    "going have having into just like made make more most much only other over really said same some still such " +
    "than that their them then there these they thing things this those through today very want wanted was were " +
    "what when where which while will with would your you're feel felt good time day days week"
  ).split(" "),
);

/** Words worth matching: 4+ letters, not common filler. Capitalised words
 *  (usually names) are marked with a leading "!". */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[\p{L}][\p{L}'-]{2,}/gu)) {
    const raw = m[0];
    const w = raw.toLowerCase();
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w);
    if (/^\p{Lu}/u.test(raw)) out.add(`!${w}`);
  }
  return out;
}

function score(line: MemoryLine, query: Set<string>): number {
  let s = line.base ?? 0;
  for (const w of keywords(line.text)) {
    if (w.startsWith("!")) continue;
    if (query.has(w)) s += query.has(`!${w}`) ? 3 : 1;
  }
  return s;
}

/** The best lines for `queryText` within `budgetTokens`, grouped by source in
 *  the order the sources first appear. Lines with no match and no base score
 *  are left out. */
export function pickRelevant(lines: MemoryLine[], queryText: string, budgetTokens: number): string {
  const query = keywords(queryText);
  const ranked = lines
    .map((l, i) => ({ l, i, s: score(l, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const chosen: typeof ranked = [];
  let used = 0;
  for (const r of ranked) {
    const cost = estimateTokens(r.l.text) + 2;
    if (used + cost > budgetTokens) continue;
    chosen.push(r);
    used += cost;
  }
  if (chosen.length === 0) return "(nothing that matches today)";
  chosen.sort((a, b) => a.i - b.i);
  const groups = new Map<string, string[]>();
  for (const c of chosen) {
    const g = groups.get(c.l.source) ?? [];
    g.push(c.l.text);
    groups.set(c.l.source, g);
  }
  return Array.from(groups.entries())
    .map(([source, texts]) => `${source}:\n${texts.map((t) => `- ${t}`).join("\n")}`)
    .join("\n");
}

/** A block of text as lines: bullet points or sentences, trimmed. */
export function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((l) => (l.trim().startsWith("-") ? [l] : l.split(/(?<=[.!?])\s+(?=\p{Lu})/u)))
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 2);
}

/** Cuts text to about `tokens`, at a line end where possible. */
export function clip(text: string, tokens: number): string {
  const max = tokens * 3.5;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf("\n");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}\n[…cut to fit]`;
}
