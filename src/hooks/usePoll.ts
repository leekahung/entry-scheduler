import { useEffect, useRef } from "react";

/**
 * Runs `poll` now and every `ms` after, but only while the tab is on screen.
 *
 * A phone left in a pocket would otherwise keep polling all afternoon, and the
 * board's rate limit is shared by a whole waiting room behind one address, so
 * the tabs nobody is reading are spending the budget of the ones that are.
 * Coming back polls straight away only where the wait has run out meanwhile:
 * a board that went stale is refetched, but flicking between two tabs does not
 * ask the server every time, whatever `ms` says.
 *
 * `active` is what a caller with nothing to poll for yet passes — a console
 * that is signed out, or one the server has stopped answering.
 */
export function usePoll(poll: () => void, ms: number, active = true): void {
  // Through a ref, so a caller that rebuilds its callback on every render does
  // not restart the interval — and reset the wait — each time.
  const latest = useRef(poll);
  latest.current = poll;
  // When a poll last went out. Kept across hiding and showing, so coming back
  // picks up the wait that was already running rather than starting a new one.
  const lastRun = useRef(0);

  useEffect(() => {
    if (!active) return;
    // Only hiding and showing carries the wait over: a console switching
    // itself back on has just emptied its board, so it polls at once.
    lastRun.current = 0;
    // Holds a timeout or an interval by turns; clearTimeout ends either.
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      lastRun.current = Date.now();
      latest.current();
    };
    const start = () => {
      if (timer) return;
      const due = ms - (Date.now() - lastRun.current);
      if (due <= 0) {
        run();
        timer = setInterval(run, ms);
        return;
      }
      // Back part-way through the wait: sit out what is left of it, then
      // settle into the interval from there.
      timer = setTimeout(() => {
        run();
        timer = setInterval(run, ms);
      }, due);
    };
    const stop = () => {
      clearTimeout(timer);
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
