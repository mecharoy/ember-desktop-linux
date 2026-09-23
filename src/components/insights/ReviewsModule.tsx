import { useState } from "react";
import type { MonthlyReport, WeeklyReview } from "../../db/types";
import type { ReviewClaim } from "../../db/reviews";
import type { MonthStats } from "../../insights/stats";
import { addDays } from "../../insights/stats";
import { writeCurrentWeekReview } from "../../ai/review";
import { FORMULATION_KEYS, parseFormulation, type FormulationKey } from "../../ai/monthly";
import { FortnightSummarySchema, type FortnightSummary } from "../../ai/fortnightly";
import type { MemorySummary } from "../../db/types";
import TopicsList from "./TopicsList";
import MemoryFilesEditor from "./MemoryFilesEditor";
import type { Topic } from "../../db/types";
import { ModuleCard } from "./ModuleCard";
import { shortDate } from "../../insights/format";

const P_LABELS: Record<FormulationKey, { title: string; plain: string }> = {
  presenting: { title: "What was hard", plain: "the main difficulties this month" },
  predisposing: { title: "Background", plain: "longer-standing things you've described" },
  precipitating: { title: "What set it off", plain: "triggers for the hard stretches" },
  perpetuating: { title: "What kept it going", plain: "what made it harder to shift" },
  protective: { title: "What helped", plain: "people, habits and strengths that held" },
};

/** The monthly "5 Ps": how clinicians sum up what's going on, each point linked to its days. */
function FormulationView({ json, onOpen }: { json: string | null; onOpen: (label: string, dates: string[]) => void }) {
  const f = parseFormulation(json);
  if (!f) return null;
  return (
    <div className="mt-1 grid max-w-3xl grid-cols-1 gap-x-8 gap-y-3 border-t border-line pt-3 md:grid-cols-2">
      {FORMULATION_KEYS.filter((k) => f[k].length > 0).map((k) => (
        <div key={k}>
          <p className="text-[12.5px] text-fg">
            {P_LABELS[k].title} <span className="text-fg-faint">— {P_LABELS[k].plain}</span>
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {f[k].map((p) => (
              <li key={p.point}>
                <button
                  onClick={() => onOpen(P_LABELS[k].title.toLowerCase(), p.dates)}
                  className="text-left text-[14.5px] leading-snug text-fg-dim hover:text-fg"
                  title="Open the entries behind this"
                >
                  {p.point}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function parseSummary(json: string): FortnightSummary | null {
  try {
    return FortnightSummarySchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

const SUMMARY_SECTIONS: [keyof FortnightSummary, string][] = [
  ["life_context", "Life context"],
  ["mood_and_energy", "Mood and energy"],
  ["sleep_and_routine", "Sleep and routine"],
  ["relationships", "Relationships"],
  ["strengths_and_coping", "Strengths and coping"],
  ["patterns", "Patterns noticed"],
  ["wellbeing_checks", "Wellbeing questionnaires"],
];

/** What Elytra carries into conversations, shown in full — no hidden memory. */
function MemoryTab({ summaries, onOpen }: { summaries: MemorySummary[]; onOpen: (label: string, dates: string[]) => void }) {
  const [open, setOpen] = useState<number | null>(summaries[summaries.length - 1]?.number ?? null);
  if (summaries.length === 0) {
    return (
      <p className="hint max-w-xl">Elytra&rsquo;s memory of you starts after two weeks of entries.</p>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-line border-y border-line">
      {summaries
        .slice()
        .reverse()
        .map((row) => {
          const s = parseSummary(row.summary);
          const isOpen = open === row.number;
          return (
            <div key={row.number}>
              <button
                onClick={() => setOpen(isOpen ? null : row.number)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between py-2.5 text-left text-[13px] text-fg-dim transition-colors hover:text-fg"
              >
                <span>
                  Summary {row.number} · {shortDate(row.period_start)} – {shortDate(row.period_end)} ·{" "}
                  {row.source_days.split(",").filter(Boolean).length} entries
                </span>
                <span className={`text-fg-faint transition-transform duration-300 ease-settle ${isOpen ? "rotate-90" : ""}`} aria-hidden="true">
                  &rsaquo;
                </span>
              </button>
              {isOpen && s && (
                <div className="fade-up flex max-w-[68ch] flex-col gap-2.5 pb-4">
                  <p className="font-serif text-[16px] leading-[1.6] text-fg">{s.overview}</p>
                  {SUMMARY_SECTIONS.filter(([k]) => (s[k] as string).trim()).map(([k, label]) => (
                    <p key={k} className="text-[13.5px] leading-relaxed text-fg-dim">
                      <span className="text-fg">{label}.</span> {s[k] as string}
                    </p>
                  ))}
                  {s.threads.length > 0 && (
                    <div>
                      <p className="text-[13.5px] text-fg">Ongoing threads</p>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {s.threads.map((t) => (
                          <li key={t.thread}>
                            <button
                              onClick={() => onOpen(`thread: ${t.thread}`, t.dates)}
                              disabled={t.dates.length === 0}
                              className="text-left text-[13.5px] leading-snug text-fg-dim enabled:hover:text-fg"
                            >
                              <span className="text-fg-faint">[{t.status}]</span> {t.thread}
                              {t.note ? ` — ${t.note}` : ""}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {s.open_loops.length > 0 && (
                    <p className="text-[13.5px] leading-relaxed text-fg-dim">
                      <span className="text-fg">Open loops.</span> {s.open_loops.join(" · ")}
                    </p>
                  )}
                  {s.follow_up.length > 0 && (
                    <p className="text-[13.5px] leading-relaxed text-fg-dim">
                      <span className="text-fg">To follow up.</span> {s.follow_up.join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function parseClaims(json: string): ReviewClaim[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((c) => c?.claim && c?.evidence) : [];
  } catch {
    return [];
  }
}

function parseStats(json: string): MonthStats | null {
  try {
    const s = JSON.parse(json);
    return s && typeof s === "object" ? (s as MonthStats) : null;
  } catch {
    return null;
  }
}

function dayCount(sourceDays: string | null): number | null {
  return sourceDays ? sourceDays.split(",").filter(Boolean).length : null;
}

/** "Week of Aug 31 · from 1 day · written Sep 6" — so a thin or early review
 * is visibly thin, not mistaken for a verdict on the whole week. */
function weekMeta(r: WeeklyReview): string {
  const n = dayCount(r.source_days);
  return [
    `Week of ${shortDate(r.week_start)}`,
    n !== null ? `from ${n} day${n === 1 ? "" : "s"}` : null,
    `written ${shortDate(r.created_at)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ClaimCard({
  title,
  claims,
  tone,
  weekDates,
  onOpen,
}: {
  title: string;
  claims: ReviewClaim[];
  tone: "warm" | "neutral";
  weekDates: string[];
  onOpen: (label: string, dates: string[]) => void;
}) {
  return (
    <div className={`flex-1 rounded-[14px] p-4 ${tone === "warm" ? "bg-moss-wash" : "bg-surface-high/70"}`}>
      {/* Told apart by the ground, not by the ink: forest is the only green
          that clears AA for text on these washes. */}
      <h3 className={`spec ${tone === "warm" ? "text-moss" : "text-fg-dim"}`}>{title}</h3>
      {claims.length === 0 ? (
        <p className="hint mt-1.5">Nothing with clear evidence this week, and that&rsquo;s fine.</p>
      ) : (
        <ul className="-mx-2 mt-1.5 flex flex-col gap-0.5">
          {claims.map((c) => {
            // A claim links to the days it cites; older claims without dates
            // link to the whole week.
            const dates = c.dates && c.dates.length > 0 ? c.dates : weekDates;
            return (
              <li key={c.claim}>
                <button
                  onClick={() => onOpen(c.claim, dates)}
                  disabled={dates.length === 0}
                  className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ground/70 disabled:hover:bg-transparent"
                  title={dates.length > 0 ? `Open the ${dates.length} entr${dates.length === 1 ? "y" : "ies"} behind this` : undefined}
                >
                  <span className="block text-[14.5px] leading-snug text-fg">{c.claim}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-fg-faint">{c.evidence}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MonthNumbers({ s }: { s: MonthStats }) {
  const f = (n: number | null) => (n === null ? "–" : n.toFixed(1));
  const items = [
    { label: "days journaled", value: String(s.daysJournaled) },
    { label: "average mood", value: f(s.avgMood) },
    { label: "average energy", value: f(s.avgEnergy) },
    { label: "main theme", value: s.topTheme ? s.topTheme.key : "–" },
    { label: "best week", value: s.bestWeek ? shortDate(s.bestWeek.weekStart) : "–" },
  ];
  return (
    <div className="grid grid-cols-5 divide-x divide-line border-y border-line py-3">
      {items.map((i) => (
        <div key={i.label} className="min-w-0 px-3 first:pl-0">
          <div className="text-[11px] text-fg-faint">{i.label}</div>
          <div className="truncate font-serif text-[18px] text-fg" title={i.value}>
            {i.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Weekly cards and letters, monthly reports. */
export default function ReviewsModule({
  reviews,
  monthly,
  summaries,
  entryDates,
  onOpen,
  onChanged,
  topics,
  onTopicStatus,
  onTopicRemove,
}: {
  topics: Topic[];
  onTopicStatus: (key: string, status: Topic["status"]) => void;
  onTopicRemove: (key: string) => void;
  reviews: WeeklyReview[];
  monthly: MonthlyReport[];
  summaries: MemorySummary[];
  entryDates: string[];
  onOpen: (label: string, dates: string[]) => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"weekly" | "monthly" | "memory">("weekly");
  const [openWeek, setOpenWeek] = useState<string | null>(reviews[0]?.week_start ?? null);
  const [update, setUpdate] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const latest = reviews[0] ?? null;
  const datesOfWeek = (weekStart: string) => {
    const end = addDays(weekStart, 6);
    return entryDates.filter((d) => d >= weekStart && d <= end);
  };

  async function handleUpdateWeek() {
    setUpdate({ busy: true, message: "Writing this week's review…" });
    try {
      const r = await writeCurrentWeekReview();
      if (r === null) setUpdate({ busy: false, message: "No entries have been read this week yet." });
      else if (r.ok) {
        setUpdate({ busy: false, message: "Updated. It gets written again once the week is over." });
        onChanged();
      } else setUpdate({ busy: false, message: `Couldn't write it: ${r.error}` });
    } catch (e) {
      setUpdate({ busy: false, message: `Couldn't write it: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return (
    <ModuleCard
      title="Reviews"
      aside={
        <div className="flex gap-0.5">
          {(["weekly", "monthly", "memory"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={t === tab} className="seg">
              {t === "weekly" ? "Weekly" : t === "monthly" ? "Monthly" : "Memory"}
            </button>
          ))}
        </div>
      }
    >
      {tab === "weekly" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button onClick={handleUpdateWeek} disabled={update.busy} className="btn-subtle">
              {update.busy ? "Writing…" : "Update this week's review"}
            </button>
            {update.message && <span className="text-[12.5px] text-fg-faint">{update.message}</span>}
          </div>
          {!latest ? (
            <p className="hint max-w-xl">Your first weekly letter lands when a week ends.</p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-fg-faint">{weekMeta(latest)}</p>
              <div className="flex flex-col gap-3 md:flex-row">
                <ClaimCard
                  title="You're good at"
                  claims={parseClaims(latest.strengths)}
                  tone="warm"
                  weekDates={datesOfWeek(latest.week_start)}
                  onOpen={onOpen}
                />
                <ClaimCard
                  title="Worth your attention"
                  claims={parseClaims(latest.focus_areas)}
                  tone="neutral"
                  weekDates={datesOfWeek(latest.week_start)}
                  onOpen={onOpen}
                />
              </div>
              <div className="mt-5 flex flex-col divide-y divide-line border-y border-line">
                {reviews.map((r) => {
                  const open = openWeek === r.week_start;
                  return (
                    <div key={r.week_start}>
                      <button
                        onClick={() => setOpenWeek(open ? null : r.week_start)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between py-2.5 text-left text-[13px] text-fg-dim transition-colors hover:text-fg"
                      >
                        <span>{weekMeta(r)}</span>
                        <span
                          className={`text-fg-faint transition-transform duration-300 ease-settle ${open ? "rotate-90" : ""}`}
                          aria-hidden="true"
                        >
                          &rsaquo;
                        </span>
                      </button>
                      {open && (
                        <p className="fade-up max-w-[64ch] whitespace-pre-wrap pb-4 font-serif text-[16px] leading-[1.65] text-fg">
                          {r.letter}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : tab === "memory" ? (
        <div className="flex flex-col gap-8">
          <MemoryFilesEditor />
          <TopicsList topics={topics} onStatus={onTopicStatus} onRemove={onTopicRemove} />
          <MemoryTab summaries={summaries} onOpen={onOpen} />
        </div>
      ) : monthly.length === 0 ? (
        <p className="hint max-w-xl">Your first monthly report lands when a month ends.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {monthly.map((m) => {
            const s = parseStats(m.stats);
            return (
              <article key={m.month} className="flex flex-col gap-3">
                <h3 className="font-serif text-[17px] text-fg">
                  {new Date(`${m.month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </h3>
                {s && <MonthNumbers s={s} />}
                <p className="max-w-[64ch] whitespace-pre-wrap font-serif text-[16px] leading-[1.65] text-fg">{m.letter}</p>
                <p className="text-[13px] text-moss">
                  <span className="font-serif italic">What changed:</span> {m.changed}
                </p>
                <FormulationView json={m.formulation} onOpen={(label, dates) => onOpen(`${m.month} · ${label}`, dates)} />
              </article>
            );
          })}
        </div>
      )}
    </ModuleCard>
  );
}
