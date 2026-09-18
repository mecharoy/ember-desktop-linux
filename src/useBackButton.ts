import { useEffect, useRef } from "react";

let depth = 0;
// A reload keeps the current history entry's old state; start from the bottom.
history.replaceState({ emberDepth: 0 }, "");

/**
 * Makes Android's back gesture close something (a sheet, an open entry, a
 * tab other than Today) instead of leaving the app. While `open`, one history
 * entry is kept for it; going back pops that entry and calls `close`. Closing
 * it any other way removes the entry again, so back presses never pile up.
 * Nested ones close innermost first: each only answers when history drops
 * below its own depth.
 */
export function useBackButton(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const mine = ++depth;
    history.pushState({ emberDepth: mine }, "");
    let popped = false;
    const onPop = () => {
      const now = (history.state as { emberDepth?: number } | null)?.emberDepth ?? 0;
      if (now >= mine) return;
      popped = true;
      window.removeEventListener("popstate", onPop);
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      depth = mine - 1;
      if (!popped) history.back();
    };
  }, [open]);
}
