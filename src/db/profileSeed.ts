// First-run profile seeding. The counselor's personal context comes from the
// profile table, which is otherwise empty until the first
// weekly review — a full week of generic sessions. Onboarding's optional
// questions seed it directly, in the user's own words, with no AI call (no
// provider may be configured yet). The weekly reviewer folds the current
// profile into every rewrite, so this seed evolves rather than going stale.
//
// Pure composition logic lives here (not in profile.ts) so it can be unit
// tested without pulling in the tauri sql client.

export interface SeedAnswer {
  /** Third-person label, e.g. "Currently weighing on them" — the profile is
   * consumed by the counselor prompt as "About them: {profile_summary}". */
  label: string;
  text: string;
}

/**
 * Renders the answered questions as a compact self-portrait for the profile
 * table, or null when nothing was answered (leave the profile untouched so
 * the empty-layers path stays intact).
 */
export function composeSeedProfile(
  name: string,
  answers: SeedAnswer[],
  dateKey: string,
): string | null {
  const filled = answers
    .map((a) => ({ label: a.label, text: a.text.trim() }))
    .filter((a) => a.text.length > 0);
  if (filled.length === 0) return null;

  const who = name.trim() || "The user";
  return [
    `${who}'s first-setup self-portrait, in their own words (${dateKey}):`,
    ...filled.map((a) => `- ${a.label}: ${a.text}`),
  ].join("\n");
}
