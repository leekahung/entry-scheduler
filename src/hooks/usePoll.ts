import { useEffect, useRef } from "react";

/**
 * Runs `poll` now and every `ms` after, but only while the tab is on screen.
 *
 * A phone left in a pocket would otherwise keep polling all afternoon, and the
 * board's rate limit is shared by a whole waiting room behind one address, so
 * the tabs nobody is reading are spending the budget of the ones that are.
 * Coming back polls straight away, so nobody is shown a board that went stale
 * while they were away.
 *
 * `active` is what a caller with nothing to poll for yet passes — a console
 * that is signed out, or one the server has stopped answering.
 */
export function usePoll(poll: () => void, ms: number, active = true): void {
  // Through a ref, so a caller that rebuilds its callback on every render does
  // not restart the interval — and reset the wait — each time.
  const latest = useRef(poll);
  latest.current = poll;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (timer) return;
      latest.current();
      timer = setInterval(() => latest.current(), ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ms, active]);
}
