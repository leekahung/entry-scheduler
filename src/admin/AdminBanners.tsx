import type { AdminAlerts, ApiError } from "../shared/api";
import { minutesAgo } from "../shared/time";

// One or two failures is someone fumbling their own passcode; a handful in a
// quarter hour is worth staff looking up.
const ALERT_FROM = 3;

const BANNER = "banner banner-caution";

// Louder than BANNER: this one wants someone to act, not just to know.
const ALERT = "banner banner-alert";

type Props = {
  offline: boolean;
  /** Set when the server stopped the poll; a 401 is handled by signing out. */
  rejected: ApiError | null;
  onResume: () => void;
  /** A month that ended with its entries still on the board. */
  monthToClose: string;
  alerts: AdminAlerts | null;
};

/**
 * The standing state of the console, above the queue: a server it cannot
 * reach, a month left unclosed, someone guessing at the passcode. What a
 * single action did — saved, removed, failed — is a toast instead.
 */
export default function AdminBanners({
  offline,
  rejected,
  onResume,
  monthToClose,
  alerts,
}: Props) {
  return (
    <>
      {offline && (
        <p className={BANNER} role="status">
          Can&rsquo;t reach the server — this list may be out of date.
        </p>
      )}

      {rejected && rejected.status !== 401 && (
        <p className={BANNER} role="status">
          {rejected.message} The list has stopped refreshing.{" "}
          <button
            type="button"
            className="self-start bg-transparent p-0 text-accent underline"
            onClick={onResume}
          >
            Try again
          </button>
        </p>
      )}

      {monthToClose && (
        <p className={ALERT} role="status">
          <strong>{monthToClose} is not closed out yet.</strong> Entries from
          then are still on the board. Finished ones move into the{" "}
          {monthToClose} tab by themselves at the next change; anything still
          open stays here until someone works it.
        </p>
      )}

      {alerts && alerts.failedAttempts >= ALERT_FROM && (
        <p className={ALERT} role="status">
          <strong>{alerts.failedAttempts} failed sign-in attempts</strong> in
          the last {alerts.windowMinutes} minutes
          {alerts.lastAttemptAt &&
            `, most recent ${minutesAgo(alerts.lastAttemptAt)}`}
          . Check with the other admins — if it was none of them, rotate the
          passcode.
        </p>
      )}
    </>
  );
}
