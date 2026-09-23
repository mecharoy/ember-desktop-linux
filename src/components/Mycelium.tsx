import { useEffect, useMemo, useState } from "react";

/**
 * The ground under every page: a mycelium — the thread network a fungus
 * spreads under a forest floor, joining one thing to another out of sight.
 * It is what a journal does with days, which is why it is the one pattern
 * the cabinet floor carries.
 *
 * Grown once per window size from a fixed seed, so it is the same network
 * every time the app opens. It spreads from colonies past the corners and
 * fades out before the middle, where the reading happens; on a wide window it
 * lives in the margins beside the column. Pure decoration: hidden from screen readers,
 * never takes a click, and drawn in `moss` at a low opacity so it works in
 * both themes without knowing which one is on.
 */

interface Thread {
  d: string;
  w: number;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hyphae as random walks that branch, thin out, and stop where they meet. */
function grow(width: number, height: number): { threads: Thread[]; knots: [number, number, number][] } {
  const rand = mulberry32(0x5e1f7a);
  const STEP = 7;
  const CELL = 6;
  // Where a thread already runs, so another one meeting it stops there (the
  // joins are what make it a network rather than a set of trees).
  const taken = new Map<string, number>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  const threads: Thread[] = [];
  const knots: [number, number, number][] = [];

  interface Tip {
    x: number;
    y: number;
    a: number;
    gen: number;
    life: number;
    id: number;
  }
  let nextId = 0;
  const tips: Tip[] = [];
  const span = Math.hypot(width, height);

  // Colonies just past the corners, spreading inward: two big ones on the
  // diagonal and a smaller one, so the network grows from somewhere.
  const colonies: [number, number, number][] = [
    [-20, height + 20, 1],
    [width + 20, -20, 0.85],
    [width + 20, height + 30, 0.5],
  ];
  for (const [ox, oy, weight] of colonies) {
    const toward = Math.atan2(height / 2 - oy, width / 2 - ox);
    const n = Math.round(16 * weight);
    for (let i = 0; i < n; i++) {
      const a = toward + (i / (n - 1) - 0.5) * 1.9 + (rand() - 0.5) * 0.15;
      tips.push({ x: ox, y: oy, a, gen: 0, life: (span * 0.36 * weight * (0.55 + rand() * 0.6)) / STEP, id: nextId++ });
    }
  }

  while (tips.length > 0 && threads.length < 1400) {
    const tip = tips.shift()!;
    let { x, y, a } = tip;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    let steps = 0;
    let joined = false;
    for (; steps < tip.life; steps++) {
      a += (rand() - 0.5) * 0.28;
      const nx = x + Math.cos(a) * STEP;
      const ny = y + Math.sin(a) * STEP;
      if (nx < -40 || ny < -40 || nx > width + 40 || ny > height + 40) break;
      const k = key(nx, ny);
      const owner = taken.get(k);
      if (owner !== undefined && owner !== tip.id && steps > 3) {
        d += ` L${nx.toFixed(1)} ${ny.toFixed(1)}`;
        if (rand() < 0.5) knots.push([nx, ny, 1.4]);
        joined = true;
        break;
      }
      taken.set(k, tip.id);
      d += ` L${nx.toFixed(1)} ${ny.toFixed(1)}`;
      x = nx;
      y = ny;
      // Branch: a thinner, shorter thread off to one side.
      if (tip.gen < 5 && steps > 4 && rand() < 0.07) {
        const side = rand() < 0.5 ? -1 : 1;
        tips.push({
          x,
          y,
          a: a + side * (0.35 + rand() * 0.55),
          gen: tip.gen + 1,
          life: (tip.life - steps) * (0.5 + rand() * 0.4),
          id: nextId++,
        });
        if (rand() < 0.25) knots.push([x, y, 1 + rand()]);
      }
    }
    if (steps > 1) threads.push({ d, w: Math.max(0.45, 1.6 - tip.gen * 0.3) });
    // A free end sometimes swells, the way a hypha tip does.
    if (!joined && steps > 12 && rand() < 0.35) knots.push([x, y, 1.3 + rand() * 1.5]);
  }
  return { threads, knots };
}

export default function Mycelium() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSize({ w: window.innerWidth, h: window.innerHeight }), 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, []);

  const net = useMemo(() => grow(size.w, size.h), [size.w, size.h]);

  return (
    <svg
      className="mycelium"
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="none"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {net.threads.map((t, i) => (
          <path key={i} d={t.d} strokeWidth={t.w} pathLength={1} />
        ))}
      </g>
      <g className="mycelium-knots">
        {net.knots.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} />
        ))}
      </g>
    </svg>
  );
}
