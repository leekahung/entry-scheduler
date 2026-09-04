import { useCallback, useEffect, useState } from "react";
import { usePoll } from "./usePoll";
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
  fetchAdminAlerts,
  fetchAllEntries,
  updateDetails,
  updatePriority,
  updateStatus,
  type AdminAlerts,
} from "../shared/api";

const POLL_MS = 5000;

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
export function useEntries(passcode: string, unlocked: boolean) {
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null);
  const [offline, setOffline] = useState(false);
  // A verdict from the server rather than a network problem, which has to stop
  // the poll: only failed requests count against the admin rate limit, so five
  // seconds of retrying would spend the whole budget and lock staff out of
  // signing back in.
  const [rejected, setRejected] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState("");
  // Until the first fetch lands, no entries means unknown, not empty.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextEntries, nextAlerts] = await Promise.all([
        fetchAllEntries(passcode),
        // Owners only. A staff session is refused here, which is not a
        // connection problem and must not read as one — they simply have no
        // sign-in warning to see. Anything else is a real failure, and hiding
        // it would leave an owner quietly blind to the warning.
        fetchAdminAlerts(passcode).catch((err) => {
          if (err instanceof ApiError && err.status === 403) return null;
          throw err;
        }),
      ]);
      setEntries(nextEntries);
      setAlerts(nextAlerts);
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

  /** Runs a mutation, surfacing its failure without disturbing the poll. */
  const run = useCallback(
    async (fallback: string, action: () => Promise<void>) => {
      setActionError("");
      try {
        await action();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : fallback);
        return false;
      }
    },
    [],
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
    actionError,
    rejected,
    refresh,

    // Clears a server verdict so the poll can start again. The poll stays off
    // until something asks for this, so a rate limit cannot re-trip itself.
    resume: () => setRejected(null),

    setStatus: (entry: AdminEntry, status: Status, helpedBy: string) =>
      run("Could not update that entry.", async () => {
        replace(await updateStatus(passcode, entry.id, status, helpedBy));
      }),

    setPriority: (entry: AdminEntry, priority: Priority) =>
      run("Could not change that priority.", async () => {
        replace(await updatePriority(passcode, entry.id, priority));
        // Retriaging moves the row, and only the server decides where to.
        await refresh();
      }),

    saveDetails: (entry: AdminEntry, details: EntryChanges) =>
      run("Could not save those changes.", async () => {
        replace(await updateDetails(passcode, entry.id, details));
        await refresh();
      }),

    book: (booking: NewBooking) =>
      run("Could not book that in.", async () => {
        await bookEntry(passcode, booking);
        // Refresh rather than append: the server decides where in the line a
        // booking lands, and appending would flash it in the wrong place.
        await refresh();
      }),

    remove: (entry: AdminEntry) =>
      run("Could not remove that entry.", async () => {
        await deleteEntry(passcode, entry.id);
        setEntries((current) => current.filter((row) => row.id !== entry.id));
      }),

    // Nothing leaves the board: this only copies it into the month tabs.
    saveMonths: async () => {
      let saved: string[] = [];
      const ok = await run("Could not save to the month tabs.", async () => {
        saved = (await archiveMonths(passcode)).months;
      });
      return ok ? saved : null;
    },
  };
}
