import { useEffect, useRef } from "react";

/**
 * Runs `poll` now and every `ms` after, only while the tab is visible, since
 * hidden tabs would spend a waiting room's shared rate limit.
 * Coming back polls at once only if the wait ran out; `active` pauses it.
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
