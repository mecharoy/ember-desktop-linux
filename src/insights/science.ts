// What each Insights section is built on, shown behind its ⓘ button and, in
// short, on the first-run screen. Keep every source real and checkable.

export interface ModuleScience {
  /** How to read the section. */
  read: string;
  /** The psychology behind it. */
  basis: string;
  /** What the section can't tell you. Shown behind the (i), not on the page. */
  caution?: string;
  source: string;
}

export const SCIENCE: Record<string, ModuleScience> = {
  mood: {
    read: "Bold line: your 7-day average, broken where a week has no entries. Dots: single days. Rings: the best and hardest day in view.",
    basis: "Daily ratings swing a lot; averages over a week show where things are actually heading. Diary studies track mood the same way.",
    source: "Bolger, Davis & Rafaeli (2003), Diary methods, Annual Review of Psychology",
  },
  rhythm: {
    read: "Mood by weekday against your usual (dashed line); faint bars have too few days to trust. Below: the hours you tend to jot notes.",
    basis: "Mood follows the week's structure, for example lifting on weekends when people have more say over their time.",
    source: "Ryan, Bernstein & Brown (2010), Journal of Social and Clinical Psychology",
  },
  themes: {
    read: "What keeps coming up in your entries, and whether it is growing or fading. Tap a name to read the days behind it, or its small chart to see it day by day over a month.",
    basis: "Putting experiences into words and returning to them is how writing helps people make sense of them.",
    source: "Pennebaker & Beall (1986), Journal of Abnormal Psychology",
  },
  people: {
    read: "Who appears in your days, most recent first. No rankings, no scores. Tap a name to read the days behind it, or its small chart to see it day by day over a month.",
    basis: "The quality of our relationships is one of the strongest predictors of wellbeing and even of health.",
    source: "Holt-Lunstad, Smith & Layton (2010), PLoS Medicine",
  },
  habits: {
    read: "Habits found in your entries. Pin the ones worth tracking to get a calendar and a tick box in the evening check-in.",
    basis: "Habits form through repetition in a steady context, and take weeks to months to feel automatic, so a visible record helps.",
    caution: "The mood comparison shows how days with and without a habit differ. It is an association, not evidence that the habit changes your mood.",
    source: "Lally, van Jaarsveld, Potts & Wardle (2010), European Journal of Social Psychology",
  },
  movers: {
    read: "Links between your mood and your habits, sleep, people and themes, shown only with at least 10 days on each side and a clear gap.",
    basis: "Self-monitoring turns vague impressions into patterns you can test.",
    caution: "These are associations within your own days. They can suggest what to try, but they do not show that one thing causes another.",
    source: "Bolger, Davis & Rafaeli (2003), Annual Review of Psychology",
  },
  emotions: {
    read: "The feeling words in your days and how often each shows up.",
    basis: "People who name feelings precisely (emotional granularity) cope better with strong emotions than those who only feel 'good' or 'bad'.",
    source: "Kashdan, Barrett & McKnight (2015), Current Directions in Psychological Science",
  },
  wellbeing: {
    read: "Your scores on standard questionnaires, taken every two weeks.",
    basis: "WHO-5 measures wellbeing; PHQ-9 and GAD-7 are the screening questionnaires clinicians use for low mood and anxiety.",
    caution: "Scores are a screening aid, not a diagnosis. If a result concerns you, talk to a doctor or a mental health professional.",
    source: "Topp et al. (2015); Kroenke, Spitzer & Williams (2001); Spitzer et al. (2006)",
  },
  sleep: {
    read: "Bedtime, time up, time to fall asleep and how regular those are, from the sleep diary in your check-in.",
    basis: "These are the core items of the sleep diary used in insomnia therapy (CBT-I).",
    source: "Carney et al. (2012), The Consensus Sleep Diary, Sleep",
  },
  routine: {
    read: "How regular five daily anchors were over the last 4 weeks: getting up, first contact, starting work, dinner, bed.",
    basis: "Scored like the Social Rhythm Metric. Irregular daily rhythms and unsteady mood tend to go together.",
    source: "Monk, Frank, Potts & Kupfer (2002), Journal of Sleep Research",
  },
  activities: {
    read: "What you did, with how much enjoyment and achievement your words suggest, and how mood compares on days with and without it.",
    basis: "Behavioural activation: doing things that bring enjoyment or a sense of achievement lifts mood, and dropping them lets it sink.",
    caution: "Enjoyment and achievement are Ember's reading of your words, and the mood columns compare days with and without an activity. They show patterns, not causes. A fall in enjoyable activities and lower mood tend to feed each other, so a drop is worth a look.",
    source: "Jacobson et al. (1996); Dimidjian et al. (2006), Journal of Consulting and Clinical Psychology",
  },
  thinking: {
    read: "Thinking traps that came up on more than one day, each with words you actually wrote.",
    basis: "Cognitive behavioural therapy teaches people to spot habits of thought like catastrophising, which keep low mood going.",
    caution: "These are prompts for reflection, not a diagnosis or a judgement. Most people notice such thoughts from time to time. What matters is how often they come up and how much they weigh on you.",
    source: "Beck, Rush, Shaw & Emery (1979), Cognitive Therapy of Depression",
  },
  reviews: {
    read: "A weekly letter with what you're good at and what needs attention, a monthly report, and the running summary Ember remembers you by.",
    basis: "Noticing what went well builds wellbeing; the monthly 'five Ps' view (presenting, predisposing, precipitating, perpetuating, protective) is how clinicians make sense of a hard stretch.",
    source: "Seligman, Steen, Park & Peterson (2005), American Psychologist",
  },
};

/** When each section opens, shown under its ⓘ note. Keep in step with
 *  computeUnlocks() and the checks in windows/Insights.tsx. */
export const UNLOCK: Record<string, string> = {
  mood: "Opens after 5 journal entries.",
  rhythm: "Opens after 14 entries spread over at least 3 different weeks.",
  themes: "Opens after 10 entries.",
  people: "Opens after 10 entries.",
  habits: "Opens as soon as Ember spots a habit in one of your entries.",
  movers: "Opens after 30 entries.",
  emotions: "Opens after 20 entries.",
  wellbeing: "Always open.",
  sleep: "Opens after 7 nights with a bedtime and wake time in the check-in.",
  routine: "Opens after a full week where you noted the time of the same thing (getting up, dinner, bed…) on at least 3 days.",
  activities: "Opens after 10 entries, once an activity has come up.",
  thinking: "Opens after 10 entries.",
  reviews: "The weekly letter comes once a week with entries is over. The monthly report comes once the month is over.",
};

/** The first-run screen's short version. */
export const SCIENCE_HIGHLIGHTS: { title: string; line: string }[] = [
  { title: "Writing it down", line: "Putting a day into words helps you make sense of it (Pennebaker)." },
  { title: "Mood that means something", line: "Weekly averages and standard wellbeing questionnaires: WHO-5, PHQ-9, GAD-7." },
  { title: "Sleep and routine", line: "The sleep diary from insomnia therapy and the Social Rhythm Metric." },
  { title: "What lifts you", line: "Behavioural activation: which activities bring enjoyment and achievement." },
  { title: "Thinking traps", line: "Patterns from cognitive behavioural therapy, always quoted from your own words." },
  { title: "Naming feelings", line: "More precise feeling words, better coping (emotional granularity)." },
];
