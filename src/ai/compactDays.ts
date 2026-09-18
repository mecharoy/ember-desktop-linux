// One short line per journaled day, for small models. The weekly, monthly and
// memory-summary jobs normally read each day's full extracted record as JSON;
// a month of that overflows a small model's window, and small models read
// plain lines better than nested JSON anyway. Pure — tested in compactDays.test.ts.

type Keyed = { key?: unknown; sentiment?: unknown; done?: unknown };

function sign(s: unknown): string {
  return typeof s === "number" ? (s > 0.15 ? "+" : s < -0.15 ? "−" : "") : "";
}

function keyed(list: unknown, fmt: (x: Keyed) => string | null): string {
  if (!Array.isArray(list)) return "";
  return list
    .map((x) => (x && typeof x === "object" ? fmt(x as Keyed) : null))
    .filter((s): s is string => Boolean(s))
    .join(", ");
}

function words(list: unknown): string {
  return Array.isArray(list) ? list.filter((w) => typeof w === "string").join(", ") : "";
}

/** "mood 6, energy 5, slept 7h. Argued with Dad. | themes: thesis+, family− | habits: gym ✓ …" */
export function compactDayLine(rawJson: string): string {
  let x: Record<string, unknown>;
  try {
    x = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return "(unreadable)";
  }
  const head = [
    typeof x.mood === "number" ? `mood ${x.mood}` : null,
    typeof x.energy === "number" ? `energy ${x.energy}` : null,
    typeof x.sleep_hours === "number" ? `slept ${x.sleep_hours}h` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const parts = [
    [head, typeof x.summary_line === "string" ? x.summary_line : ""].filter(Boolean).join(". "),
    ["themes", keyed(x.themes, (t) => (typeof t.key === "string" ? `${t.key}${sign(t.sentiment)}` : null))],
    ["habits", keyed(x.habits, (h) => (typeof h.key === "string" ? `${h.key} ${h.done ? "✓" : "✗"}` : null))],
    ["people", keyed(x.people, (p) => (typeof p.key === "string" ? `${p.key}${sign(p.sentiment)}` : null))],
    ["felt", words(x.emotions_named) || words(x.emotions)],
    ["strengths", words(x.strengths_shown)],
    ["struggles", words(x.struggles_shown)],
  ];
  return parts
    .map((p) => (typeof p === "string" ? p : p[1] ? `${p[0]}: ${p[1]}` : ""))
    .filter(Boolean)
    .join(" | ");
}
