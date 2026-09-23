import { useEffect, useRef } from "react";

/**
 * How deep a thing sits. Back closes the deepest open one first: a sheet
 * before the day it covers, a day before the tab it is on. Registration order
 * cannot be trusted for this — React runs a child's effects before its
 * parent's, so a Journal day that stayed open while you were on another tab
 * registered BELOW the tab when you came back, and "← Journal" then closed
 * the tab and dropped you on Today (error.txt, 2026-09-23).
 */
export const BACK_TAB = 0;
export const BACK_PAGE = 1;
export const BACK_SHEET = 2;

interface Layer {
  level: number;
  order: number;
  close: () => void;
}

// Everything open, one history entry each.
const layers: Layer[] = [];
let counter = 0;
// A reload keeps the current history entry's old state; start from the bottom.
history.replaceState({ emberDepth: 0 }, "");

function deepest(): Layer | undefined {
  let top: Layer | undefined;
  for (const l of layers) {
    if (!top || l.level > top.level || (l.level === top.level && l.order > top.order)) top = l;
  }
  return top;
}

// One listener for all of them: going back closes as many layers as history
// dropped, deepest first. A layer closed some other way has already taken its
// own entry off (below), so its history.back() closes nothing more.
window.addEventListener("popstate", () => {
  const now = (history.state as { emberDepth?: number } | null)?.emberDepth ?? 0;
  while (layers.length > now) {
    const top = deepest();
    if (!top) break;
    layers.splice(layers.indexOf(top), 1);
    top.close();
  }
});

/**
 * Makes Android's back gesture (and the mouse back button) close something —
 * a sheet, an open entry, a tab other than Today — instead of leaving the app.
 * While `open`, one history entry is kept for it; going back pops that entry
 * and calls `close`. Closing it any other way removes the entry again, so back
 * presses never pile up.
 */
export function useBackButton(open: boolean, close: () => void, level: number = BACK_SHEET): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const layer: Layer = { level, order: ++counter, close: () => closeRef.current() };
    layers.push(layer);
    history.pushState({ emberDepth: layers.length }, "");
    return () => {
      const i = layers.indexOf(layer);
      if (i === -1) return; // back already closed it and took its entry
      layers.splice(i, 1);
      history.back();
    };
  }, [open, level]);
}
