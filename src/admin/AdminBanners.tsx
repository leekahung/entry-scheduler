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
  actionError: string;
  downloadError: string;
  /** The month tabs the last sync wrote, or null once dismissed. */
  savedMonths: string[] | null;
  onDismissSaved: () => void;
  /** A month that ended with its entries still on the board. */
  monthToClose: string;
  alerts: AdminAlerts | null;
};

/** Everything the console has to say about itself, above the queue. */
export default function AdminBanners({
  offline,
  rejected,
  onResume,
  actionError,
  downloadError,
  savedMonths,
  onDismissSaved,
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

      {(actionError || downloadError) && (
        <p className="m-0 text-meta text-danger">
          {actionError || downloadError}
        </p>
      )}

      {savedMonths && savedMonths.length > 0 && (
        <p className="m-0 flex flex-wrap items-baseline gap-3 text-meta text-muted">
          <span role="status">Synced {savedMonths.join(" and ")}.</span>
          {/* Dismissed by whoever asked for it, rather than on a timer that
              could take it away before it has been read. */}
          <button
            type="button"
            className="bg-transparent p-0 text-accent underline"
            onClick={onDismissSaved}
          >
            Dismiss
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
