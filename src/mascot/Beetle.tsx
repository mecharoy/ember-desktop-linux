import { useEffect, useRef } from "react";
import ElytraMascot, { type Mascot, type MascotState } from "./mascot";
import { subscribe, subscribeFlash, wake } from "./pulse";
import { currentTheme, onThemeChange } from "../theme";
import "./mascot.css";

interface BeetleProps {
  /** px. The beetle keeps a 5:6 box and reads down to about 24px. */
  size?: number;
  /** Pin it to one state. Leave unset to follow the app (pulse.ts). */
  state?: MascotState;
  className?: string;
  /** For decoration only; the app never depends on it being announced. */
  title?: string;
}

/**
 * The beetle. One per window, in an anchored spot — the sidebar foot on the
 * desktop, the day's header on a phone. Left to itself it follows whatever
 * the app is doing (mascot/pulse.ts); give it `state` to pin it.
 *
 * The kit's CSS freezes every loop under "reduce motion", so there is nothing
 * to switch off here.
 */
export default function Beetle({ size = 64, state, className = "", title }: BeetleProps) {
  const host = useRef<HTMLDivElement>(null);
  const mascot = useRef<Mascot | null>(null);

  useEffect(() => {
    if (!host.current) return;
    // The kit is a vendored asset that paints itself, so it is the one thing
    // in the app that has to be TOLD the theme rather than inheriting tokens.
    // It ships light-on-cream — a near-black body, which disappears on the
    // dark ground — and carries a dark variant with a cream body and pale
    // wings. The switch is one data attribute on its own element, so the
    // theme can change under it without a remount.
    const el = host.current;
    const dress = (t: "light" | "dark") => {
      if (t === "dark") el.dataset.theme = "dark";
      else delete el.dataset.theme;
    };
    const m = ElytraMascot.mount(el, {
      state: state ?? "idle",
      ...(currentTheme() === "dark" ? { theme: "dark" as const } : {}),
    });
    mascot.current = m;
    const offTheme = onThemeChange(dress);
    return () => {
      offTheme();
      m.destroy();
      mascot.current = null;
    };
  }, []);

  // Pinned.
  useEffect(() => {
    if (state) mascot.current?.set(state);
  }, [state]);

  // Or following the app.
  useEffect(() => {
    if (state) return;
    const off = subscribe((s) => mascot.current?.set(s));
    const offFlash = subscribeFlash((s) => mascot.current?.once(s));
    // Scrolling and reading claim nothing, so they have to count as presence
    // here or the beetle dozes off with someone looking right at it.
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", wake, opts);
    window.addEventListener("keydown", wake, opts);
    window.addEventListener("wheel", wake, opts);
    return () => {
      off();
      offFlash();
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, [state]);

  return (
    <div
      ref={host}
      className={className}
      style={{ width: size, aspectRatio: "5 / 6" }}
      title={title}
      aria-hidden="true"
    />
  );
}
