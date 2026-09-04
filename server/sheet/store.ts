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
  /**
   * Resolves once the filing a change set going has finished. A change answers
   * before its filing, so this is the only thing that knows the work is done:
   * shutdown waits on it, and so do the tests.
   */
  settled(): Promise<void>;
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
  // The read on its way to Google, shared by everyone who asks while it runs.
  let reading: Promise<Entry[]> | null = null;
  // Bumped by every write, so a read that was already in flight cannot put its
  // pre-write copy of the board into the cache afterwards.
  let generation = 0;
  // Read-modify-write over a whole tab has no transaction behind it, so
  // writes are queued rather than interleaved.
  let queue: Promise<unknown> = Promise.resolve();
  // The filing the last change set going, for `settled` to wait on.
  let filing: Promise<void> = Promise.resolve();

  /**
   * The board, from cache while it is fresh.
   *
   * Callers that arrive while a read is in flight join it rather than starting
   * their own: at five-second polling a full waiting room would otherwise each
   * spend a Sheets read of their own the moment the cache expires, which is
   * how the per-minute quota goes and the board goes dark for everybody.
   */
  async function load(): Promise<Entry[]> {
    if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
    if (reading) return reading;

    const at = generation;
    const run = (async () => {
      const entries = fromSheetValues(await transport.read());
      // Not once a write has begun: that write reads the board for itself, and
      // this older copy landing on top of what it saved would take the entry
      // someone just added back off the board until the cache next expired.
      if (at === generation) {
        cache = entries;
        cachedAt = Date.now();
      }
      return entries;
    })();
    reading = run;
    const finished = () => {
      if (reading === run) reading = null;
    };
    run.then(finished, finished);
    return run;
  }

  async function save(entries: Entry[]): Promise<void> {
    await transport.write(toSheetValues(entries));
    // Anything read while this write was in flight is the board as it was
    // before it. A slow write outlives the cache it was built on — a
    // rate-limited call backs off for seconds — so a poll can start, read the
    // old board, and land after this. It must not overwrite what was saved.
    generation += 1;
    cache = entries;
    cachedAt = Date.now();
  }

  /**
   * Copies the board into a tab per month it spans, merging rather than
   * replacing so a month already filed away keeps its rows.
   */
  async function syncMonths(entries: Entry[]): Promise<SyncResult> {
    const open = openTab;
    if (!open) return { months: [], entries: 0 };
    // Side by side: every month is a different tab, so they have nothing to
    // serialize over, and a year of them one after another is a read and a
    // write each — a minute of round trips with the queue held all the while.
    const filed = await Promise.all(
      [...byMonth(entries)].map(async ([key, rows]) => {
        const tab = open(monthTab(key));
        const merged = mergeById(fromSheetValues(await tab.read()), rows);
        await tab.write(toSheetValues(merged));
        return { month: monthTab(key), rows: rows.length };
      }),
    );
    return {
      months: filed.map(({ month }) => month),
      entries: filed.reduce((total, { rows }) => total + rows, 0),
    };
  }

  /**
   * Files away a month that has ended: everything on the board goes to its own
   * month tab, then the finished rows from earlier months come off the board.
   * Runs on the first change of a new month, so nobody has to remember to.
   */
  async function rollOver(): Promise<void> {
    if (!openTab) return;
    // The board as the change left it; `save` refreshes the cache, and a
    // change that saved nothing has nothing to file.
    const entries = cache ?? (await load());
    const stale = new Set(finishedBefore(entries, currentMonth()));
    if (stale.size === 0) return;
    try {
      await syncMonths(entries);
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

  /** Runs work against the freshest copy of the tab, one caller at a time. */
  function queued<T>(work: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    const run = queue.then(async () => {
      // Never from cache, and never from a read already on its way: a write
      // must not be built on a copy of the board taken before the last one
      // landed.
      generation += 1;
      cache = null;
      reading = null;
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
    const result = queued(mutate);
    // Filing joins the same queue, so it still never interleaves with a write
    // — but off the caller's path. It is a read and a write per month the
    // board spans, and the visitor whose check-in happens to be the month's
    // first should not stand at the kiosk through all of them.
    const filed = queue.then(rollOver).catch((error) => {
      // The board stands and the next change files again, but without a line
      // here nobody would ever learn that filing had stopped working.
      console.error("Filing the ended month away failed:", error);
    });
    queue = filed;
    filing = filed;
    return result;
  }

  return {
    list: () => load(),
    settled: () => filing,

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
