/**
 * How long a reply each background job asks for, in tokens. From a real run
 * (two weeks of entries, Gemini Flash-Lite, Sep 2026) the longest replies
 * were: journal 290, extraction 313, weekly 587, monthly 884, memory 860.
 * Monthly and memory grow with a full month and a previous summary, so they
 * get the most room. Each provider caps these at what its tier allows.
 */
export const JOB_REPLY_TOKENS = {
  journal: 1200,
  extract: 1200,
  weekly: 1600,
  monthly: 2400,
  memory: 2400,
} as const;
