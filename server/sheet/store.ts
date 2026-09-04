import {
  byMonth,
  currentMonth,
  finishedBefore,
  mergeById,
  monthTab,
} from "./archive.js";
import {
  type Booking,
  type Entry,
  type EntryUpdate,
  type Intake,
  UPDATABLE,
} from "../domain/entry.js";
import { blankEntry, fromSheetValues, toSheetValues } from "./columns.js";

/** How long a read of the spreadsheet is reused before going back to Google. */
export const CACHE_MS = 5000;

/**
 * Reads and writes the whole tab. The Google implementation lives in
 * `sheets.ts`; tests supply an in-memory one.
 */
export type SheetTransport = {
  read(): Promise<(string | number)[][]>;
  write(values: (string | number)[][]): Promise<void>;
};

/** What a sync wrote, for the console to report back. */
export type SyncResult = { months: string[]; entries: number };

export type Store = {
  list(): Promise<Entry[]>;
  add(
    name: string,
    note: string,
    intake?: Intake,
    booking?: Booking,
  ): Promise<Entry>;
  update(id: number, update: EntryUpdate): Promise<Entry | undefined>;
  remove(id: number): Promise<boolean>;
  sync(): Promise<SyncResult>;
};

export type StoreOptions = {
  /**
   * Opens the tab a month is archived in, creating it when it is not there
   * yet. Left out — as the tests do — nothing is archived and the board is
   * simply the whole record.
   */
  openTab?: (tab: string) => SheetTransport;
};

/**
 * The queue, kept in the clinic's spreadsheet.
 *
 * Every write rewrites the whole tab, and reads are served from a short-lived
 * cache so the five-second polling of the board and the console does not
 * spend the Sheets read quota.
 */
export function createStore(
  transport: SheetTransport,
  { openTab }: StoreOptions = {},
): Store {
  let cache: Entry[] | null = null;
  let cachedAt = 0;
  // Read-modify-write over a whole tab has no transaction behind it, so
  // writes are queued rather than interleaved.
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Entry[]> {
    if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
    const entries = fromSheetValues(await transport.read());
    cache = entries;
    cachedAt = Date.now();
    return entries;
  }

  async function save(entries: Entry[]): Promise<void> {
    await transport.write(toSheetValues(entries));
    cache = entries;
    cachedAt = Date.now();
  }

  /**
   * Copies the board into a tab per month it spans, merging rather than
   * replacing so a month already filed away keeps its rows.
   */
  async function syncMonths(entries: Entry[]): Promise<SyncResult> {
    if (!openTab) return { months: [], entries: 0 };
    const months: string[] = [];
    let written = 0;
    for (const [key, rows] of byMonth(entries)) {
      const tab = openTab(monthTab(key));
      const merged = mergeById(fromSheetValues(await tab.read()), rows);
      await tab.write(toSheetValues(merged));
      months.push(monthTab(key));
      written += rows.length;
    }
    return { months, entries: written };
  }

  /**
   * Files away a month that has ended: everything on the board goes to its own
   * month tab, then the finished rows from earlier months come off the board.
   * Runs on the first change of a new month, so nobody has to remember to.
   */
  async function rollOver(entries: Entry[]): Promise<Entry[]> {
    if (!openTab) return entries;
    const stale = new Set(finishedBefore(entries, currentMonth()));
    if (stale.size === 0) return entries;
    try {
      await syncMonths(entries);
    } catch (error) {
      // Filing can wait for the next change; the queue cannot. Without this a
      // month tab Google is unhappy with fails every check-in, over and over,
      // because the rollover is on the path of every write.
      console.error("Month rollover failed — the board stands:", error);
      return entries;
    }
    // Only ever after a sync that landed: a row leaves the board because it is
    // safely in its month tab, never merely because the month turned.
    const kept = entries.filter((entry) => !stale.has(entry));
    await save(kept);
    return kept;
  }

  /** Runs work against the freshest copy of the tab, one caller at a time. */
  function queued<T>(work: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    const run = queue.then(async () => {
      // Never from cache: a write must not be built on a stale read.
      cache = null;
      return work(await load());
    });
    // Keep the chain alive even when this caller's write fails.
    queue = run.catch(() => {});
    return run;
  }

  /**
   * A read-modify-write, with the rollover behind it: a change is what files
   * an ended month away. It runs after rather than before, so a change always
   * lands on the board staff were looking at — filing first would 404 the very
   * row someone reopened or removed from the Done tab. Saving to the month
   * tabs deliberately does not go through here — copying the board must never
   * empty part of it.
   */
  function change<T>(mutate: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    return queued(async (entries) => {
      const result = await mutate(entries);
      // The board as the mutation left it: `save` refreshes the cache, and a
      // mutation that changed nothing never saved.
      await rollOver(cache ?? entries);
      return result;
    });
  }

  return {
    list: () => load(),

    add(name, note, intake, booking) {
      return change(async (entries) => {
        const now = new Date().toISOString();
        const entry: Entry = {
          ...blankEntry(),
          // The spreadsheet has no AUTOINCREMENT; the next id comes from the
          // rows themselves, so a cleared tab starts again at #1.
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

    update(id, update) {
      return change(async (entries) => {
        const existing = entries.find((entry) => entry.id === id);
        if (!existing) return undefined;

        const merged: Entry = { ...existing };
        for (const field of UPDATABLE) {
          Object.assign(merged, { [field]: update[field] ?? existing[field] });
        }
        merged.status = update.status ?? existing.status;
        // Only an explicit reopen clears the claim. Keying off the resolved
        // status would also wipe a name typed onto an entry that is merely
        // still waiting.
        if (update.status === "new") merged.helpedBy = "";
        merged.updatedAt = new Date().toISOString();

        await save(entries.map((entry) => (entry.id === id ? merged : entry)));
        return merged;
      });
    },

    remove(id) {
      return change(async (entries) => {
        const left = entries.filter((entry) => entry.id !== id);
        if (left.length === entries.length) return false;
        await save(left);
        return true;
      });
    },

    // Nothing is taken off the board, whatever month it is: this copies, and
    // only a queue change files an ended month away. The board is written back
    // as well as copied, which renames any headers an older version left.
    sync: () =>
      queued(async (entries) => {
        await save(entries);
        return syncMonths(entries);
      }),
  };
}
