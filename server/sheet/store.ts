import {
  byMonth,
  currentMonth,
  finishedBefore,
  mergeById,
  monthKey,
  monthTab,
  monthTabs,
} from "./archive.js";
import {
  type Booking,
  type Entry,
  type EntryUpdate,
  type Intake,
  isRemoved,
  UPDATABLE,
} from "../domain/entry.js";
import {
  blankEntry,
  fromSheetValues,
  toMonthValues,
  toSheetValues,
} from "./columns.js";
import type { TabStore } from "./sheets.js";
import { fromStamp, toStamp } from "./stamp.js";

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

/** One month of the record, as the tab it is kept in. */
export type Month = { tab: string; entries: Entry[] };

export type Store = {
  list(): Promise<Entry[]>;
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
   * The board, from cache while fresh.
   * Callers during a read join it, so a polling roomful costs one read, not one
   * each, when the cache expires.
   */
  async function load(): Promise<Entry[]> {
    if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
    if (reading) return reading;

    const at = generation;
    const run = (async () => {
      const entries = fromSheetValues(await transport.read());
      // Not once a write has begun, or this older copy would overwrite the
      // board it saved.
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
    // A slow write can outlast a poll's read of the old board; bumping the
    // generation keeps that read from overwriting what was saved.
    generation += 1;
    cache = entries;
    cachedAt = Date.now();
  }

  /**
   * Copies the board into a tab per month it spans, merging rather than
   * replacing so a month already filed away keeps its rows.
   */
  async function syncMonths(entries: Entry[]): Promise<SyncResult> {
    if (!tabs) return { months: [], entries: 0 };
    const groups = [...byMonth(entries)];
    if (groups.length === 0) return { months: [], entries: 0 };

    // Only tabs that exist, under their own names: one range naming no sheet
    // can fail the whole batched read.
    const existing = monthTabs(await tabs.list());
    const archived = await tabs.read(
      groups
        .map(([key]) => existing.get(key))
        .filter((tab): tab is string => tab !== undefined),
    );

    // One batched read and write for the whole year, not a pair per month.
    const writes = groups.map(([key, rows]) => {
      // Back to the tab this month already lives in, where there is one, or a
      // second tab would be made for a month that already has one.
      const tab = existing.get(key) ?? monthTab(key);
      const merged = mergeById(fromSheetValues(archived.get(tab) ?? []), rows);
      return { tab, values: toMonthValues(merged), rows: rows.length };
    });
    await tabs.write(writes);

    return {
      months: writes.map(({ tab }) => tab),
      entries: writes.reduce((total, { rows }) => total + rows, 0),
    };
  }

  /**
   * Takes one entry out of its month tab, if it is there.
   * Matched on id and sign-in time, as `mergeById` keys them.
   */
  async function purgeFiled(going: Entry): Promise<void> {
    if (!tabs) return;
    // The spreadsheet's own name for that month, where it has one — the tab
    // `syncMonths` would have filed into, which need not be the computed name.
    const tab = monthTabs(await tabs.list()).get(monthKey(going.createdAt));
    if (!tab) return;

    const filed = fromSheetValues((await tabs.read([tab])).get(tab) ?? []);
    const left = filed.filter(
      (row) => row.id !== going.id || row.createdAt !== going.createdAt,
    );
    // A row that was never filed costs a read and nothing more.
    if (left.length === filed.length) return;
    await tabs.write([{ tab, values: toMonthValues(left) }]);
  }

  /**
   * The record a month at a time, board and filed tabs together.
   * A read, so off the write queue; board rows win over filed copies.
   */
  async function everyMonth(): Promise<Month[]> {
    const onBoard = byMonth(await load());
    const filed = tabs
      ? monthTabs(await tabs.list())
      : new Map<string, string>();
    const keys = [...new Set([...onBoard.keys(), ...filed.keys()])]
      .sort()
      .reverse();
    // Only months with a tab, under its own name, so the batched read cannot
    // fail on a missing sheet.
    const archived = tabs
      ? await tabs.read([...filed.values()])
      : new Map<string, (string | number)[][]>();

    return (
      keys
        .map((key) => {
          const rows = fromSheetValues(
            archived.get(filed.get(key) ?? "") ?? [],
          );
          // Named as the workbook should read it, whatever the spreadsheet
          // happens to call the tab it came from.
          return {
            tab: monthTab(key),
            // The workbook describes the clinic's work, so removed entries come
            // out here; only erasing takes them off the sheet.
            entries: mergeById(rows, onBoard.get(key) ?? []).filter(
              (entry) => !isRemoved(entry),
            ),
          };
        })
        // A month tab someone emptied by hand is a tab with nothing in it, and
        // an empty sheet in the workbook says less than no sheet at all.
        .filter((month) => month.entries.length > 0)
    );
  }

  /**
   * Files away a month that has ended: everything on the board goes to its own
   * month tab, then the finished rows from earlier months come off the board.
   * Runs on the first change of a new month, so nobody has to remember to.
   */
  async function rollOver(): Promise<void> {
    if (!tabs) return;
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

  /** The entry with this number, if it is still the one signed in then. */
  const find = (entries: Entry[], id: number, createdAt?: string) =>
    entries.find(
      (entry) =>
        entry.id === id &&
        (createdAt === undefined || entry.createdAt === createdAt),
    );

  /** Runs work against the freshest copy of the tab, one caller at a time. */
  function queued<T>(work: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    const run = queue.then(async () => {
      // Never from cache or an in-flight read: a write must build on the
      // board after the last write landed.
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
   * A read-modify-write, then the rollover that files an ended month away.
   * Filing after, so a change lands on the board staff were looking at.
   * Saving to the month tabs does not go through here.
   */
  function change<T>(mutate: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    const result = queued(mutate);
    // Filing queues behind the write but off the caller's path, so the month's
    // first visitor is not kept waiting at the kiosk.
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
    months: () => everyMonth(),
    settled: () => filing,

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

        await save(entries.map((entry) => (entry.id === id ? merged : entry)));
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
            entry.id === id
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
            entry.id === id
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
        await purgeFiled(going);
        await save(entries.filter((entry) => entry.id !== id));
        return true;
      });
    },

    // Copies only, whatever the month: nothing leaves the board. Writing the
    // board back also renames any old headers.
    sync: () =>
      queued(async (entries) => {
        await save(entries);
        return syncMonths(entries);
      }),
  };
}
