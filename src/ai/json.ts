/** Parses a model response that should be bare JSON but may arrive wrapped
 * in a markdown code fence. Shared by every structured-output job (journal,
 * extractor, weekly review). Throws on anything unparseable — callers own
 * the retry-once-then-degrade loop. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch (e) {
    // Small models add a sentence before or after the object.
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) throw e;
    return JSON.parse(body.slice(start, end + 1));
  }
}
