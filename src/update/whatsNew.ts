// The "What's new" card shown once after Ember has been updated.
//
// Each release with something worth pointing out gets an entry below. A
// release without one is a small fix, and the card just says so.

export interface Highlight {
  title: string;
  text: string;
}

export const RELEASE_NOTES: Record<string, Highlight[]> = {
  "0.5.2": [
    {
      title: "Themes and people, day by day",
      text: "Tap the small chart beside a theme or person to see it day by day over a month, with your mood alongside.",
    },
    {
      title: "Activities and mood",
      text: "The mood column now fills in once an activity has come up on a few days.",
    },
    {
      title: "Cleaner Insights",
      text: "Notes on how to read each section moved behind its i button.",
    },
    {
      title: "Habits",
      text: "Restore, descriptions and suggestion buttons work as they should.",
    },
  ],
  "0.5.0": [
    {
      title: "A checklist for the conversation",
      text: "Before you talk, Ember drafts what to cover: past, today and later. Cross off anything you would rather skip.",
    },
    {
      title: "Chat from your phone with any model",
      text: "The phone can now use this computer's model whichever provider you have chosen, not only a local one.",
    },
    {
      title: "Memory by topic",
      text: "What Ember remembers is kept in topic files you can read and edit under Insights.",
    },
    {
      title: "Suggestions",
      text: "Ember points out patterns and offers small changes. Add any of them to your habits with a click.",
    },
    {
      title: "Your own writing style",
      text: "Share a sample and journal entries will sound more like you.",
    },
    {
      title: "Feel and energy faces",
      text: "A colour slider with a face that changes as you move it, plus new moods: angry, confused and sleepy.",
    },
    {
      title: "Clearer habit charts",
      text: "Better legends, and a short note on what a habit seems to be connected to.",
    },
    {
      title: "More ways to connect a model",
      text: "Pick your provider from a list, now including the OpenAI API and your ChatGPT subscription through Codex.",
    },
  ],
};

export const BUG_FIXES_ONLY: Highlight[] = [{ title: "Bug fixes", text: "Small fixes and improvements." }];

/** The card's list for a version; small releases get "Bug fixes". */
export function notesFor(version: string): Highlight[] {
  return RELEASE_NOTES[version] ?? BUG_FIXES_ONLY;
}

/** 1 when a is newer than b, -1 when older, 0 when the same. */
function compare(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, "").split("-")[0].split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Whether to show the card and whether to remember this version.
 *  - a new install (or a restore onto a new phone) has nothing to compare
 *    against: remember, don't show
 *  - an install from before this was tracked (already set up, nothing
 *    remembered): show
 *  - a newer version than last time: show
 */
export function decideWhatsNew(input: {
  seen: string;
  current: string;
  /** Still on the first-run screens: nothing has changed for this person. */
  fresh: boolean;
}): "show" | "remember" | "none" {
  const { seen, current, fresh } = input;
  if (!current) return "none";
  if (fresh) return seen === current ? "none" : "remember";
  if (!seen) return "show";
  const c = compare(current, seen);
  if (c === 0) return "none";
  return c > 0 ? "show" : "remember"; // a lower version means a reinstall or rollback
}
