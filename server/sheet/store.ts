import { currentMonth, finishedBefore } from "./archive.js";
import {
  type Booking,
  type Entry,
  type EntryUpdate,
  type Intake,
  UPDATABLE,
} from "../domain/entry.js";
import { blankEntry, fromSheetValues, toSheetValues } from "./columns.js";
import { createFiling, type Month, type SyncResult } from "./filing.js";
import { createSheetCache } from "./sheetCache.js";
import type { TabStore } from "./sheets.js";
import { fromStamp, toStamp } from "./stamp.js";

/** How long a read of the spreadsheet is reused before going back to Google. */
export const CACHE_MS = 5000;

/**
 * Reads and writes the whole tab. The Google implementation lives in
 * `transport.ts`; tests supply an in-memory one.
 */
export type SheetTransport = {
  read(): Promise<(string | number)[][]>;
  write(values: (string | number)[][]): Promise<void>;
};

export type Store = {
  list(): Promise<Entry[]>;
  /** The entry with this number, and this sign-in time when given one. */
  find(id: number, createdAt?: string): Promise<Entry | undefined>;
  add(
    name: string,
    note: string,
    intake?: Intake,
    booking?: Booking,
  ): Promise<Entry>;
  /**
   * Changes by number also take the sign-in time, when given: erasing frees a
   * number, and a stale console must not change whoever holds it now.
   */
  update(
    id: number,
    update: EntryUpdate,
    createdAt?: string,
  ): Promise<Entry | undefined>;
  /**
   * Takes an entry off the board without destroying it. The row stays where
   * it is, stamped with the time, and everything that describes the clinic's
   * work filters it out.
   */
  remove(id: number, createdAt?: string): Promise<boolean>;
  /** Puts a removed entry back on the board. */
  restore(id: number, createdAt?: string): Promise<boolean>;
  /**
   * Erases an entry outright: out of its month tab as well as off the board,
   * for a row that should never have been kept at all.
   */
  purge(id: number, createdAt?: string): Promise<boolean>;
  sync(): Promise<SyncResult>;
  /**
   * The whole record a month at a time, newest first — the months already
   * filed away as well as the ones still on the board.
   */
  months(): Promise<Month[]>;
  /**
   * Resolves once the filing a change set going has finished. A change answers
   * before its filing, so this is the only thing that knows the work is done:
   * shutdown waits on it, and so do the tests.
   */
  settled(): Promise<void>;
};

export type StoreOptions = {
  /**
   * The month tabs. Left out — as some tests do — nothing is archived and the
   * board is simply the whole record.
   */
  tabs?: TabStore;
};

/**
 * The queue, kept in the clinic's spreadsheet.
 * Every write rewrites the whole tab; reads come from a short cache so polling
 * does not spend the Sheets quota.
 */
export function createStore(
  transport: SheetTransport,
  { tabs }: StoreOptions = {},
): Store {
  const { load, save, enqueue, queued } = createSheetCache(
    async () => fromSheetValues(await transport.read()),
    (entries: Entry[]) => transport.write(toSheetValues(entries)),
    CACHE_MS,
  );
  const filing = createFiling(tabs);
  // The rollover the last change set going, for `settled` to wait on.
  let lastRollover: Promise<void> = Promise.resolve();

  /**
   * Files away a month that has ended: everything on the board goes to its own
   * month tab, then the finished rows from earlier months come off the board.
   * Runs on the first change of a new month, so nobody has to remember to.
   */
  async function rollOver(): Promise<void> {
    if (!tabs) return;
    // Inside the queue no write can be running, so this read is current.
    const entries = await load();
    const stale = new Set(finishedBefore(entries, currentMonth()));
    if (stale.size === 0) return;
    try {
      await filing.sync(entries);
    } catch (error) {
      // Filing can wait for the next change; the queue cannot. Without this a
      // month tab Google is unhappy with is retried on every change forever.
      console.error("Month rollover failed — the board stands:", error);
      return;
    }
    // Only ever after a sync that landed: a row leaves the board because it is
    // safely in its month tab, never merely because the month turned.
    await save(entries.filter((entry) => !stale.has(entry)));
  }

  /** The entry with this number, if it is still the one signed in then. */
  const find = (entries: Entry[], id: number, createdAt?: string) =>
    entries.find(
      (entry) =>
        entry.id === id &&
        (createdAt === undefined || entry.createdAt === createdAt),
    );

  /**
   * A read-modify-write, then the rollover that files an ended month away.
   * Filing after, so a change lands on the board staff were looking at.
   * Saving to the month tabs does not go through here.
   */
  function change<T>(mutate: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    const result = queued(mutate);
    // Filing queues behind the write but off the caller's path, so the month's
    // first visitor is not kept waiting at the kiosk.
    lastRollover = enqueue(rollOver).catch((error) => {
      // The board stands and the next change files again, but without a line
      // here nobody would ever learn that filing had stopped working.
      console.error("Filing the ended month away failed:", error);
    });
    return result;
  }

  return {
    list: () => load(),
    find: async (id, createdAt) => find(await load(), id, createdAt),
    // A read, so off the write queue.
    months: async () => filing.months(await load()),
    settled: () => lastRollover,

    add(name, note, intake, booking) {
      return change(async (entries) => {
        // As the sheet reads it back (whole seconds, first 01:30 at DST's end),
        // or the kiosk loses its ticket once the board is reread.
        const now = fromStamp(toStamp(new Date().toISOString()));
        const entry: Entry = {
          ...blankEntry(),
          // No AUTOINCREMENT: a cleared tab restarts at #1, and erasing the top
          // entry frees its number — hence `find` checking the time too.
          id: entries.reduce((top, row) => Math.max(top, row.id), 0) + 1,
          name,
          note,
          createdAt: now,
          updatedAt: now,
          ...intake,
          ...booking,
        };
        await save([...entries, entry]);
        return entry;
      });
    },

    update(id, update, createdAt) {
      return change(async (entries) => {
        const existing = find(entries, id, createdAt);
        if (!existing) return undefined;

        const merged: Entry = { ...existing };
        for (const field of UPDATABLE) {
          Object.assign(merged, { [field]: update[field] ?? existing[field] });
        }
        merged.status = update.status ?? existing.status;
        // Back from being helped means nobody did, so the claim goes; reopening
        // a finished entry keeps it. Both key off an explicit status change.
        if (update.status === "new" && existing.status === "pending") {
          merged.helpedBy = "";
        }
        merged.updatedAt = new Date().toISOString();

        // The row found, not every row with its number.
        await save(
          entries.map((entry) => (entry === existing ? merged : entry)),
        );
        return merged;
      });
    },

    remove(id, createdAt) {
      return change(async (entries) => {
        const going = find(entries, id, createdAt);
        if (!going || going.deletedAt) return false;
        const at = new Date().toISOString();
        await save(
          entries.map((entry) =>
            entry === going
              ? { ...entry, deletedAt: at, updatedAt: at }
              : entry,
          ),
        );
        return true;
      });
    },

    restore(id, createdAt) {
      return change(async (entries) => {
        const back = find(entries, id, createdAt);
        if (!back?.deletedAt) return false;
        await save(
          entries.map((entry) =>
            entry === back
              ? { ...entry, deletedAt: "", updatedAt: new Date().toISOString() }
              : entry,
          ),
        );
        return true;
      });
    },

    purge(id, createdAt) {
      return change(async (entries) => {
        const going = find(entries, id, createdAt);
        if (!going) return false;
        // The tab first, uncaught: a half-done erase must not report success.
        // Both writes share the queue, so nothing files the row back between.
        await filing.purge(going);
        await save(entries.filter((entry) => entry !== going));
        return true;
      });
    },

    // Copies only, whatever the month: nothing leaves the board. Writing the
    // board back also renames any old headers.
    sync: () =>
      queued(async (entries) => {
        await save(entries);
        return filing.sync(entries);
      }),
  };
}
