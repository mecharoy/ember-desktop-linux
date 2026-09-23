import { useEffect, useState } from "react";
import { getCheckIn, saveCheckIn } from "../db/checkins";
import { listObservations } from "../db/observations";
import { listDismissedHabitKeys } from "../db/habitPrefs";
import { localDateKey } from "../time";
import { DAY_STRETCHES, sleepHoursFrom, toCheckInSummary } from "../ai/checkin";
import { listAssessments } from "../db/assessments";
import { getAllSettings, setSetting } from "../db/settings";
import { dueInstruments, INSTRUMENTS, parseEnabledInstruments } from "../insights/assessments";
import { addDays } from "../insights/stats";
import type { Instrument } from "../db/types";
import WellbeingCheck from "./WellbeingCheck";
import FaceSlider from "./FaceSlider";

const Optional = () => <span className="font-normal text-fg-faint"> (optional)</span>;

/** One point in the day: a time, or "not yet" / "skipped". Picking one clears
 *  the other; tapping the active choice again clears it. */
function DayPointRow({
  label,
  value,
  usual,
  allowNotYet,
  onChange,
}: {
  label: string;
  value: string;
  usual: string;
  allowNotYet: boolean;
  onChange: (v: string) => void;
}) {
  const choice = (id: string, text: string) => (
    <button
      type="button"
      onClick={() => onChange(value === id ? "" : id)}
      aria-pressed={value === id}
      className={`min-h-[36px] rounded-full border px-3 py-1 text-[13px] transition-colors duration-200 ${
        value === id ? "border-moss bg-moss text-ground" : "border-line text-fg-dim"
      }`}
    >
      {text}
    </button>
  );
  const isTime = /^\d{2}:\d{2}$/.test(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-[13.5px] text-fg">{label}</span>
      <input
        type="time"
        aria-label={`${label} time`}
        className="input w-[8.5rem]"
        value={isTime ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {!value && /^\d{2}:\d{2}$/.test(usual) && choice(usual, `usual ${usual}`)}
      {allowNotYet && choice("not-yet", "not yet")}
      {choice("skipped", "skipped")}
    </div>
  );
}

/** What they did in one stretch of the day. */
function StretchNote({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ml-3 flex flex-col gap-1 border-l border-line pl-4">
      <span className="text-[12.5px] text-fg-faint">{label}</span>
      <textarea
        rows={1}
        className="input min-h-[44px] resize-y py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What did you do?"
      />
    </label>
  );
}

/**
 * The check-in before a conversation: mood, energy, the day in stretches,
 * last night's sleep, pinned habits. Every field is optional; the answers are
 * the user's own and beat anything the AI would infer.
 */
export default function CheckInForm({
  date,
  busy,
  onStart,
  onSkip,
}: {
  date: string;
  busy: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  // Kept from an older check-in that gave hours but no bed and wake times.
  const [storedSleep, setStoredSleep] = useState<number | null>(null);
  const [feeling, setFeeling] = useState("");
  const [onMind, setOnMind] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const [habits, setHabits] = useState<Record<string, boolean>>({});
  const [bedtime, setBedtime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [latency, setLatency] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [lunch, setLunch] = useState("");
  const [eveningBreak, setEveningBreak] = useState("");
  const [dinner, setDinner] = useState("");
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  const [usual, setUsual] = useState({ lunch: "", break: "", dinner: "" });
  // Questionnaires due today, and the ones being answered right now.
  const [due, setDue] = useState<Instrument[]>([]);
  const [answering, setAnswering] = useState<Instrument[] | null>(null);

  useEffect(() => {
    (async () => {
      const [existing, habitObs, dismissed, taken, settings] = await Promise.all([
        getCheckIn(date),
        listObservations("habit"),
        listDismissedHabitKeys(),
        listAssessments(),
        getAllSettings(),
      ]);
      setUsual({ lunch: settings.usual_lunch, break: settings.usual_break, dinner: settings.usual_dinner });
      // Offered only for today: a questionnaire about "the last two weeks"
      // means nothing when dated to a day being looked back on.
      if (date === localDateKey()) {
        setDue(
          dueInstruments(
            parseEnabledInstruments(settings.assessments_enabled),
            taken,
            date,
            settings.assessments_snoozed_until,
          ),
        );
      }
      setPinned(
        habitObs.filter((o) => o.pinned === 1 && !dismissed.has(o.key.trim().toLowerCase())).map((o) => o.key),
      );
      const s = toCheckInSummary(existing);
      if (s) {
        setMood(s.mood);
        setEnergy(s.energy);
        setStoredSleep(s.sleepHours);
        setFeeling(s.feeling ?? "");
        setOnMind(s.onMind ?? "");
        setHabits(s.habits);
        setBedtime(s.bedtime ?? "");
        setWakeTime(s.wakeTime ?? "");
        setLatency(s.sleepLatencyMin === null ? "" : String(s.sleepLatencyMin));
        setQuality(s.sleepQuality);
        setLunch(s.lunch ?? "");
        setEveningBreak(s.eveningBreak ?? "");
        setDinner(s.dinner ?? "");
        setDayNotes(s.dayNotes);
      }
      setLoaded(true);
    })();
  }, [date]);

  function setHabit(key: string, done: boolean) {
    setHabits((prev) => {
      const next = { ...prev };
      if (next[key] === done) delete next[key]; // clicking the active answer clears it
      else next[key] = done;
      return next;
    });
  }

  const minutes = Number.parseInt(latency, 10);
  const latencyMin = Number.isFinite(minutes) && minutes >= 0 && minutes <= 600 ? minutes : null;
  const hoursAsleep = sleepHoursFrom(bedtime || null, wakeTime || null, latencyMin);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const notes: Record<string, string> = {};
    for (const [k, v] of Object.entries(dayNotes)) if (v.trim()) notes[k] = v.trim();
    await saveCheckIn({
      date,
      mood,
      energy,
      sleepHours: hoursAsleep ?? (bedtime || wakeTime ? null : storedSleep),
      feeling: feeling.trim() || null,
      onMind: onMind.trim() || null,
      habits,
      bedtime: bedtime || null,
      wakeTime: wakeTime || null,
      sleepLatencyMin: latencyMin,
      sleepQuality: quality,
      lunch: lunch || null,
      eveningBreak: eveningBreak || null,
      dinner: dinner || null,
      dayNotes: notes,
    });
    onStart();
  }

  async function snoozeChecks() {
    await setSetting("assessments_snoozed_until", addDays(date, 1));
    setDue([]);
  }

  if (!loaded) return <p className="p-8 text-[13px] text-fg-faint">Loading&hellip;</p>;

  if (answering && answering.length > 0) {
    const [current, ...rest] = answering;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-5">
        <WellbeingCheck
          key={current}
          instrument={current}
          date={date}
          onDone={() => {
            setDue((prev) => prev.filter((i) => i !== current));
            setAnswering(rest.length > 0 ? rest : null);
          }}
          onCancel={() => setAnswering(null)}
        />
      </div>
    );
  }

  const isToday = date === localDateKey();
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
  const stretchLabel = (i: number) => {
    const s = DAY_STRETCHES[i];
    return i === 3 ? "After dinner" : `${s.from[0].toUpperCase()}${s.from.slice(1)} → ${s.to}`;
  };
  const note = (i: number) => (
    <StretchNote
      label={stretchLabel(i)}
      value={dayNotes[DAY_STRETCHES[i].key] ?? ""}
      onChange={(v) => setDayNotes((prev) => ({ ...prev, [DAY_STRETCHES[i].key]: v }))}
    />
  );
  // Nothing to write about a stretch that hasn't begun yet.
  const reached = (point: string) => !(isToday && point === "not-yet");

  return (
    <form onSubmit={handleStart} className="fade-up flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-5 pb-10 pt-5">
      <h2 className="section-title">{isToday ? "Check-in" : `Check-in · ${weekday}`}</h2>

      {due.length > 0 && (
        <div className="flex max-w-xl flex-col gap-2 border-l-2 border-moss/60 pl-4">
          <p className="text-[13.5px] leading-relaxed text-fg">
            Wellbeing check due: {due.map((i) => INSTRUMENTS[i].name).join(" and ")}. About a minute.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAnswering(due)} className="btn-subtle">
              Take it now
            </button>
            <button type="button" onClick={snoozeChecks} className="btn-ghost">
              Not today
            </button>
          </div>
        </div>
      )}

      <div className="grid max-w-2xl grid-cols-1 gap-6 md:grid-cols-2">
        <FaceSlider
          kind="mood"
          label={isToday ? "Mood (optional)" : `Mood on ${weekday} (optional)`}
          value={mood}
          onChange={setMood}
        />
        <FaceSlider kind="energy" label="Energy (optional)" value={energy} onChange={setEnergy} />
      </div>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="label">
          In a word or two, how {isToday ? "do" : "did"} you feel?
          <Optional />
        </span>
        <input className="input" value={feeling} onChange={(e) => setFeeling(e.target.value)} placeholder="drained, a bit hopeful" />
      </label>

      <div className="flex max-w-xl flex-col gap-2.5">
        <span className="label">
          {isToday ? "Your day so far" : `Your ${weekday}`}
          <Optional />
        </span>
        {note(0)}
        <DayPointRow label="Lunch" value={lunch} usual={usual.lunch} allowNotYet={isToday} onChange={setLunch} />
        {reached(lunch) && (
          <>
            {note(1)}
            <DayPointRow label="Break" value={eveningBreak} usual={usual.break} allowNotYet={isToday} onChange={setEveningBreak} />
            {reached(eveningBreak) && (
              <>
                {note(2)}
                <DayPointRow label="Dinner" value={dinner} usual={usual.dinner} allowNotYet={isToday} onChange={setDinner} />
                {reached(dinner) && note(3)}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex max-w-xl flex-col gap-2">
        <span className="label">
          {isToday ? "Last night" : "The night before"}
          <Optional />
        </span>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-fg-faint">
            Got into bed
            <input type="time" className="input w-full" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-fg-faint">
            Got up
            <input type="time" className="input w-full" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-fg-faint">
            Minutes to fall asleep
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              step={5}
              className="input w-full"
              value={latency}
              onChange={(e) => setLatency(e.target.value)}
              placeholder="15"
            />
          </label>
          <div className="flex flex-col gap-1 text-[12px] text-fg-faint">
            How well you slept
            <div className="flex gap-1" role="group" aria-label="How well you slept, 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuality(quality === n ? null : n)}
                  aria-pressed={quality === n}
                  title={n === 1 ? "very poorly" : n === 5 ? "very well" : undefined}
                  className={`h-9 w-9 rounded-full border text-[13.5px] tabular-nums transition duration-200 ease-settle active:scale-90 ${
                    quality === n ? "border-moss bg-moss text-ground" : "border-line text-fg-dim"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        {hoursAsleep !== null && <p className="text-[12.5px] text-fg-faint">About {hoursAsleep} hours asleep.</p>}
      </div>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="label">
          Anything on your mind?
          <Optional />
        </span>
        <textarea className="input min-h-[64px] resize-y" value={onMind} onChange={(e) => setOnMind(e.target.value)} />
      </label>

      {pinned.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label">
            {isToday ? "Habits today" : `Habits on ${weekday}`}
            <Optional />
          </span>
          <ul className="flex flex-col gap-1.5">
            {pinned.map((key) => (
              <li key={key} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{key}</span>
                {([true, false] as const).map((done) => (
                  <button
                    key={String(done)}
                    type="button"
                    onClick={() => setHabit(key, done)}
                    aria-pressed={habits[key] === done}
                    className={`min-h-[36px] rounded-full border px-3.5 py-1 text-[13.5px] transition-colors duration-200 ${
                      habits[key] === done
                        ? "border-moss bg-moss text-ground"
                        : "border-line text-fg-dim hover:border-fg-faint hover:text-fg"
                    }`}
                  >
                    {done ? "done" : isToday ? "not today" : "not that day"}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-stretch gap-2 pt-1 md:max-w-md">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Starting…" : isToday ? "Start the conversation" : `Start talking about ${weekday}`}
        </button>
        <button type="button" onClick={onSkip} disabled={busy} className="btn-ghost">
          Skip the check-in
        </button>
      </div>
    </form>
  );
}
