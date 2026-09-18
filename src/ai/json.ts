/** Parses a model response that should be bare JSON but may arrive wrapped
 * in a markdown code fence. Shared by every structured-output job (journal,
 * extractor, weekly review). Throws on anything unparseable — callers own
 * the retry-once-then-degrade loop. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}
