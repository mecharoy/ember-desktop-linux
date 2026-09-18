// Prompt sizing, kept apart from budget.ts so the providers can use it too
// (budget.ts reaches into providers/cloud, so importing it back would cycle).

/** Rough size of a text in tokens. Measured English runs ~3.9-4.6 characters
 *  a token; 3.5 errs on the big side, which is the safe side here. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
