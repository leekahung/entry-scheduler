// How far back the console's failed-sign-in warning looks. In memory only:
// this is a warning light for staff on shift, not an audit log.
export const ALERT_WINDOW_MS = 15 * 60 * 1000;
// A sustained attack must not grow this without bound; the exact count stops
// mattering long before the cap.
const MAX_TRACKED_FAILURES = 500;

/**
 * The failed sign-ins of the last {@link ALERT_WINDOW_MS}.
 * One per app, so one instance's counter never bleeds into another's.
 */
export function createFailureLog() {
  let failures: number[] = [];

  const recent = () => {
    const cutoff = Date.now() - ALERT_WINDOW_MS;
    failures = failures.filter((at) => at > cutoff);
    return failures;
  };

  return {
    recent,
    note: () => {
      if (recent().length < MAX_TRACKED_FAILURES) failures.push(Date.now());
    },
  };
}
