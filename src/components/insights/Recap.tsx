import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buildRecap, type RecapInput, type RecapPeriod, type Slide } from "../../insights/recap";
import { BACK_SHEET, useBackButton } from "../../useBackButton";
import { flash } from "../../mascot/pulse";

/**
 * The recap, played full screen: one fact per slide, one thing to look at on
 * each. Each slide has a single hero — a number, a word, a day — with a label
 * above it and one sentence under it, so the eye always knows where to land.
 *
 * Tap the right of the screen (or →, or Space) to go on, the left (or ←) to go
 * back, hold to pause, Escape or back to leave. Slides move on by themselves
 * except under reduced motion, where nothing moves unless asked.
 */

const SLIDE_MS = 6500;

type Tone = "forest" | "paper" | "ink" | "clay";

const TONE: Record<Slide["kind"], Tone> = {
  open: "forest",
  mood: "paper",
  bestDay: "ink",
  theme: "forest",
  people: "paper",
  feelings: "clay",
  lift: "forest",
  sleep: "ink",
  streak: "clay",
  close: "forest",
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const one = (n: number) => n.toFixed(1);
const dayWord = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

function longDate(date: string, withWeekday = false): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: withWeekday ? "long" : undefined,
    day: "numeric",
    month: "long",
  });
}

function Spark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => (v === null ? null : [i, v] as const)).filter((p) => p !== null);
  if (pts.length < 2) return null;
  const w = 280;
  const h = 64;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - ((v - 1) / 9) * h;
  const d = pts.map(([i, v], k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`-6 -6 ${w + 12} ${h + 12}`} className="recap-spark" aria-hidden="true">
      <path d={d} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={5} />
    </svg>
  );
}

function Frame({ label, hero, line, children, small }: {
  label: string;
  hero: ReactNode;
  line?: ReactNode;
  children?: ReactNode;
  small?: boolean;
}) {
  return (
    <div className="recap-frame">
      <p className="recap-label">{label}</p>
      <div className={small ? "recap-hero recap-hero-word" : "recap-hero"}>{hero}</div>
      {line && <p className="recap-line">{line}</p>}
      {children && <div className="recap-detail">{children}</div>}
    </div>
  );
}

function SlideBody({ slide, period, onOpenEntry }: {
  slide: Slide;
  period: RecapPeriod;
  onOpenEntry: (date: string) => void;
}) {
  const span = period === "week" ? "week" : "month";
  switch (slide.kind) {
    case "open":
      return (
        <Frame
          label={`Your ${span} in Elytra`}
          hero={
            slide.written > 0 ? (
              <>
                {slide.written}
                <span className="recap-hero-unit"> of {slide.days}</span>
              </>
            ) : (
              "A fresh page"
            )
          }
          small={slide.written === 0}
          line={
            slide.written > 0
              ? `days written up, ${longDate(slide.from)} to ${longDate(slide.to)}.`
              : `Nothing written up between ${longDate(slide.from)} and ${longDate(slide.to)} yet.`
          }
        >
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" aria-hidden="true" className="h-12 w-12 rounded-[12px]" draggable={false} />
        </Frame>
      );
    case "mood": {
      const diff = slide.prevAvg === null ? null : slide.avg - slide.prevAvg;
      const line =
        diff === null
          ? "Your average mood, out of 10."
          : Math.abs(diff) < 0.3
            ? `Out of 10. About the same as the ${span} before.`
            : `Out of 10. ${diff > 0 ? "Up" : "Down"} ${one(Math.abs(diff))} from the ${span} before.`;
      return (
        <Frame label="How you felt" hero={one(slide.avg)} line={line}>
          <Spark values={slide.series} />
          {slide.energyAvg !== null && <p className="recap-note">Energy averaged {one(slide.energyAvg)}.</p>}
        </Frame>
      );
    }
    case "bestDay":
      return (
        <Frame
          label="Your best day"
          hero={new Date(`${slide.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}
          small
          line={slide.title ? `“${slide.title}”` : longDate(slide.date)}
        >
          {slide.line && <p className="recap-note">{slide.line}</p>}
          <button type="button" className="recap-button" onClick={(e) => { e.stopPropagation(); onOpenEntry(slide.date); }}>
            Read {longDate(slide.date)}
          </button>
        </Frame>
      );
    case "theme":
      return (
        <Frame label="On your mind" hero={cap(slide.key)} small line={`came up on ${dayWord(slide.count)}.`}>
          {slide.rest.length > 0 && <p className="recap-note">Then {slide.rest.map((t) => t.key).join(" · ")}</p>}
        </Frame>
      );
    case "people": {
      const feel =
        slide.feel === "good" ? " Mostly on good days." : slide.feel === "heavy" ? " Often on heavier days." : "";
      return (
        <Frame label="Who was around" hero={slide.key} small line={`in your days ${slide.count} times.${feel}`}>
          {slide.rest.length > 0 && <p className="recap-note">Also {slide.rest.map((p) => p.key).join(" · ")}</p>}
        </Frame>
      );
    }
    case "feelings":
      return (
        <Frame
          label={slide.own ? "In your own words" : "How it felt"}
          small
          hero={
            <span className="recap-words">
              {slide.words.map((w, i) => (
                <span key={w.word} style={{ opacity: 1 - i * 0.24 }}>
                  {w.word}
                </span>
              ))}
            </span>
          }
          line={slide.own ? "The feelings you named most." : "The feelings Elytra heard most."}
        />
      );
    case "lift":
      return (
        <Frame
          label="What lifted you"
          hero={cap(slide.activity)}
          small
          line={`Days with it averaged ${one(slide.withAvg)}, against ${one(slide.withoutAvg)} without.`}
        >
          <p className="recap-note">From {dayWord(slide.days)} with it. A pattern, not a promise.</p>
        </Frame>
      );
    case "sleep":
      return (
        <Frame
          label="Your nights"
          hero={
            <>
              {one(slide.avgHours)}
              <span className="recap-hero-unit"> h</span>
            </>
          }
          line={`of sleep on average, over ${slide.nights} nights.`}
        >
          {slide.bedtime && <p className="recap-note">Usually in bed around {slide.bedtime}.</p>}
        </Frame>
      );
    case "streak":
      return (
        <Frame label="Keeping at it" hero={slide.days} line="days in a row. The longer the run, the more there is to read." />
      );
    case "close":
      return (
        <Frame
          label={`That was your ${span}`}
          hero="Keep going."
          small
          line={
            slide.notes > 0
              ? `${slide.notes} quick note${slide.notes === 1 ? "" : "s"} fed into it.`
              : "Quick notes during the day give the evening more to work with."
          }
        >
          {slide.suggestion && <p className="recap-note">Something to try: {slide.suggestion}</p>}
        </Frame>
      );
  }
}

export default function Recap({
  input,
  onClose,
  onOpenEntry,
}: {
  input: Omit<RecapInput, "period">;
  onClose: () => void;
  onOpenEntry: (date: string) => void;
}) {
  const [period, setPeriod] = useState<RecapPeriod>("week");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const still = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const slides = useMemo(() => buildRecap({ ...input, period }), [input, period]);
  const slide = slides[Math.min(index, slides.length - 1)];
  const last = index >= slides.length - 1;
  // Reaching the end is worth a hop; the beetle does it as the recap closes.
  const finished = useRef(false);
  if (last) finished.current = true;
  useEffect(() => () => {
    if (finished.current) flash("celebrate");
  }, []);
  const held = useRef<{ at: number; timer: number | undefined }>({ at: 0, timer: undefined });

  useBackButton(true, onClose, BACK_SHEET);

  const next = () => setIndex((i) => Math.min(i + 1, slides.length - 1));
  const prev = () => setIndex((i) => Math.max(i - 1, 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function choosePeriod(p: RecapPeriod) {
    setPeriod(p);
    setIndex(0);
  }

  // Tap: left third goes back, the rest goes on. Holding pauses instead.
  const onControl = (e: PointerEvent) => (e.target as HTMLElement).closest("button") !== null;
  function onPointerDown(e: PointerEvent) {
    if (onControl(e)) return;
    held.current.at = Date.now();
    held.current.timer = window.setTimeout(() => setPaused(true), 220);
  }
  function onPointerUp(e: PointerEvent) {
    if (onControl(e)) return;
    window.clearTimeout(held.current.timer);
    const wasHold = Date.now() - held.current.at > 220;
    setPaused(false);
    if (wasHold) return;
    if (e.clientX < window.innerWidth / 3) prev();
    else next();
  }

  const tone = TONE[slide.kind];

  // Rendered at the top of the document: the page it opens from is animated,
  // and an animated parent traps a fixed child inside its own box, under the dock.
  return createPortal(
    <div
      className={`recap fade-in tone-${tone}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Your ${period} recap`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        window.clearTimeout(held.current.timer);
        setPaused(false);
      }}
    >
      <div className="recap-dots" aria-hidden="true" />
      <div className="recap-top" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <div className="recap-bars" aria-hidden="true">
          {slides.map((_, i) => (
            <span key={`${period}-${i}`} className="recap-bar">
              <span
                className={i < index ? "recap-fill done" : i === index ? "recap-fill now" : "recap-fill"}
                style={
                  i === index && !still && !last
                    ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? "paused" : "running" }
                    : i === index && (still || last)
                      ? { transform: "scaleX(1)" }
                      : undefined
                }
                onAnimationEnd={i === index ? next : undefined}
              />
            </span>
          ))}
        </div>
        <div className="recap-controls">
          <div className="recap-period" role="group" aria-label="Recap period">
            {(["week", "month"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={period === p} onClick={() => choosePeriod(p)}>
                {p === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <button type="button" className="recap-close" onClick={onClose} aria-label="Close the recap">
            &times;
          </button>
        </div>
      </div>

      <div key={`${period}-${index}`} className="recap-stage alight-slow" aria-live="polite">
        <SlideBody
          slide={slide}
          period={period}
          onOpenEntry={(date) => {
            onClose();
            onOpenEntry(date);
          }}
        />
      </div>

      <div className="recap-foot" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        {last ? (
          <>
            <button type="button" className="recap-button" onClick={() => setIndex(0)}>
              Play again
            </button>
            <button type="button" className="recap-button solid" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          index === 0 && <p className="recap-hint">Tap to go on · hold to pause</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
