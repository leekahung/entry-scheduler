import { useCallback, useEffect, useState } from "react";
import { usePoll } from "./usePoll";
import type { ToastLabels, Toasts } from "../shared/toasts";
import type {
  AdminEntry,
  CaseDetails,
  Intake,
  Priority,
  Status,
} from "../shared/types";
import {
  ApiError,
  archiveMonths,
  bookEntry,
  deleteEntry,
  purgeEntry,
  restoreEntry,
  fetchAdminAlerts,
  fetchAllEntries,
  updateDetails,
  updatePriority,
  updateStatus,
  type AdminAlerts,
} from "../shared/api";

const POLL_MS = 5000;
/**
 * Failed sign-ins are counted on the server and change rarely, so the console
 * asks for them a sixth as often as the queue. Polled together they doubled
 * every console's requests to show a banner that is almost always the same.
 */
const ALERTS_POLL_MS = 30_000;

/** Two staff work one queue, so a row can go while someone is acting on it. */
const goneFrom = (id: number) =>
  `#${id} is no longer on the board — someone else may have removed it.`;

/**
 * What a sync wrote, said in a sentence.
 *
 * A first sync of a board that has never been filed can span a year, and
 * naming twelve tabs makes a toast nobody reads — past three, the count is the
 * useful part. `Intl.ListFormat` handles the commas and the "and" for the rest.
 */
const NAMED_UP_TO = 3;
export function syncedMonths(months: string[]): string {
  if (months.length === 0) return "Nothing to sync — the board is empty.";
  if (months.length > NAMED_UP_TO) return `Synced ${months.length} months.`;
  const list = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format(months);
  return `Synced ${list}.`;
}

/** What a status change is called once it has landed. */
const STATUS_SAID: Record<Status, (id: number, from: Status) => string> = {
  pending: (id) => `Helping #${id}.`,
  resolved: (id) => `#${id} marked helped.`,
  // Nothing was closed when the change comes back from being helped, so the
  // one transition is said two ways.
  new: (id, from) =>
    from === "pending" ? `#${id} back to waiting.` : `#${id} reopened.`,
};

export type EntryDetails = {
  helpedBy: string;
  adminNote: string;
  priority: Priority;
  scheduledFor: string;
} & Intake &
  CaseDetails;

/** Only the fields the editor actually changed, so a save cannot clobber. */
export type EntryChanges = Partial<EntryDetails>;

export type NewBooking = Parameters<typeof bookEntry>[1];

/**
 * Owns the entry list, its polling, and every mutation staff can make.
 *
 * Failed saves are kept apart from the connection state: the poll runs every
 * five seconds, so folding them together would wipe "could not save" off the
 * screen before anyone read it.
 */
export function useEntries(
  passcode: string,
  unlocked: boolean,
  toasts: Toasts,
  /** Whether this session may read the sign-in warning at all. */
  owner: boolean,
) {
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null);
  const [offline, setOffline] = useState(false);
  // A verdict from the server rather than a network problem, which has to stop
  // the poll: only failed requests count against the admin rate limit, so five
  // seconds of retrying would spend the whole budget and lock staff out of
  // signing back in.
  const [rejected, setRejected] = useState<ApiError | null>(null);
  // Until the first fetch lands, no entries means unknown, not empty.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await fetchAllEntries(passcode));
      setOffline(false);
      setLoaded(true);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.status === 429)
      ) {
        setRejected(err);
        return;
      }
      setOffline(true);
    }
  }, [passcode]);

  const refreshAlerts = useCallback(async () => {
    try {
      setAlerts(await fetchAdminAlerts(passcode));
    } catch (err) {
      // Owners only. A staff session is refused here, which is not a
      // connection problem and must not read as one — they simply have no
      // sign-in warning to see.
      if (err instanceof ApiError && err.status === 403) {
        setAlerts(null);
        return;
      }
      // Anything else stays on the last count rather than clearing the
      // banner: the queue's own poll is what reports a console that has gone
      // offline or had its session refused, and it runs six times as often.
    }
  }, [passcode]);

  // Locked again: forget the queue, so the next sign-in starts from nothing
  // rather than showing the last session's board while the first poll lands.
  useEffect(() => {
    if (unlocked) return;
    setEntries([]);
    setAlerts(null);
    setLoaded(false);
    setOffline(false);
    setRejected(null);
  }, [unlocked]);

  usePoll(refresh, POLL_MS, unlocked && !rejected);
  // Owners only. The route refuses staff, and each refusal counts against the
  // admin rate limit every console request shares — polled regardless, a staff
  // console spends that budget on 403s until it locks itself out.
  usePoll(refreshAlerts, ALERTS_POLL_MS, unlocked && !rejected && owner);

  /**
   * Runs a mutation and says how it went, without disturbing the poll.
   * A failure is reported, never thrown: the console has to stay usable.
   */
  const { track } = toasts;
  const run = useCallback(
    <T>(labels: ToastLabels<T>, action: () => Promise<T>) =>
      track(labels, action),
    [track],
  );

  const replace = (updated: AdminEntry) =>
    setEntries((current) =>
      current.map((row) => (row.id === updated.id ? updated : row)),
    );

  return {
    entries,
    alerts,
    offline,
    loaded,
    rejected,
    refresh,

    // Clears a server verdict so the poll can start again. The poll stays off
    // until something asks for this, so a rate limit cannot re-trip itself.
    resume: () => setRejected(null),

    setStatus: (entry: AdminEntry, status: Status, helpedBy: string) =>
      run(
        {
          pending: `Updating #${entry.id}\u2026`,
          success: STATUS_SAID[status](entry.id, entry.status),
          failure: {
            fallback: "The server couldn't save that. Nothing was changed.",
            gone: goneFrom(entry.id),
          },
        },
        async () => {
          replace(await updateStatus(passcode, entry.id, status, helpedBy));
        },
      ),

    setPriority: (entry: AdminEntry, priority: Priority) =>
      run(
        {
          pending: `Retriaging #${entry.id}\u2026`,
          success: `#${entry.id} set to ${priority}.`,
          failure: {
            fallback: "The server couldn't change that. Nothing was changed.",
            gone: goneFrom(entry.id),
          },
        },
        async () => {
          replace(await updatePriority(passcode, entry.id, priority));
          // Retriaging moves the row, and only the server decides where to.
          await refresh();
        },
      ),

    saveDetails: (entry: AdminEntry, details: EntryChanges) =>
      run(
        {
          pending: `Saving #${entry.id}\u2026`,
          success: `Saved #${entry.id}.`,
          failure: {
            fallback:
              "The server couldn't save those changes. Nothing was changed.",
            gone: goneFrom(entry.id),
          },
        },
        async () => {
          replace(await updateDetails(passcode, entry.id, details));
          await refresh();
        },
      ),

    book: (booking: NewBooking) =>
      run(
        {
          pending: "Booking them in\u2026",
          success: `${booking.name} is on the list.`,
          failure: {
            fallback: "The server couldn't book that in. Nobody was added.",
          },
        },
        async () => {
          await bookEntry(passcode, booking);
          // Refresh rather than append: the server decides where in the line a
          // booking lands, and appending would flash it in the wrong place.
          await refresh();
        },
      ),

    remove: (entry: AdminEntry) =>
      run(
        {
          pending: `Removing #${entry.id}\u2026`,
          success: `Removed #${entry.id}, ${entry.name}. It can be put back.`,
          failure: {
            fallback: "The server couldn't remove that. Nothing was changed.",
            gone: `#${entry.id} was already off the board.`,
          },
        },
        async () => {
          await deleteEntry(passcode, entry.id);
          // Re-read rather than dropped: the row is still there, now carrying
          // the stamp that moves it to the Removed tab.
          await refresh();
        },
      ),

    restore: (entry: AdminEntry) =>
      run(
        {
          pending: `Putting #${entry.id} back\u2026`,
          success: `#${entry.id}, ${entry.name}, is back on the board.`,
          failure: {
            fallback: "The server couldn't restore that. Nothing was changed.",
            gone: goneFrom(entry.id),
          },
        },
        async () => {
          await restoreEntry(passcode, entry.id);
          await refresh();
        },
      ),

    purge: (entry: AdminEntry, confirm: string) =>
      run(
        {
          pending: `Erasing #${entry.id}\u2026`,
          success: `Erased #${entry.id}, ${entry.name}, from the record.`,
          failure: {
            fallback: "The server couldn't erase that. Nothing was changed.",
            gone: `#${entry.id} was already off the board.`,
          },
        },
        async () => {
          // What the owner typed, not the name already on the row: the
          // server's check is only a check if the two can disagree.
          await purgeEntry(passcode, entry.id, confirm);
          setEntries((current) => current.filter((row) => row.id !== entry.id));
        },
      ),

    // Nothing leaves the board: this only copies it into the month tabs.
    // The toast names the tabs it wrote, which is what staff asked it for.
    saveMonths: () =>
      run(
        {
          pending: "Syncing the board into its month tabs\u2026",
          success: syncedMonths,
          failure: {
            fallback:
              "The server couldn't write the month tabs. The board is unchanged.",
          },
        },
        async () => (await archiveMonths(passcode)).months,
      ),
  };
}
