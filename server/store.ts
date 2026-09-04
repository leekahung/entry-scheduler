import {
  byMonth,
  currentMonth,
  finishedBefore,
  mergeById,
  monthTab,
} from "./archive.js";
import { LOG_COLUMNS } from "./csv.js";
import { fromStamp, toStamp } from "./stamp.js";
import {
  DEFAULT_PRIORITY,
  isPriority,
  isStatus,
  type Booking,
  type Entry,
  type EntryUpdate,
  type Intake,
  UPDATABLE,
} from "./entry.js";
import type { Gender, CaseType } from "./codes.js";

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

type Cell = string | number;
type Setter = (entry: Entry, raw: string) => void;
/** A tab column: its header, how it is written, how it is read, and the
 * headers it used to go by, so an existing sheet keeps being read. */
type Column = [string, (e: Entry) => Cell, Setter | null, string[]?];

/**
 * How each human log column is read back. "Date" and "Notes" are derived and
 * merged, so their fields come from the machine columns instead.
 */
const LOG_SETTERS: Record<string, Setter | null> = {
  Date: null,
  Notes: null,
  "Client Name": (e, raw) => {
    e.name = raw;
  },
  DOB: (e, raw) => {
    e.dob = raw;
  },
  Gender: (e, raw) => {
    e.gender = raw as Gender | "";
  },
  "Phone #": (e, raw) => {
    e.phone = raw;
  },
  "Case Type": (e, raw) => {
    e.caseType = raw as CaseType | "";
  },
  "Appointment Type": (e, raw) => {
    e.appointmentType = raw as Entry["appointmentType"];
  },
  "Appointment Outcome": (e, raw) => {
    e.appointmentOutcome = raw as Entry["appointmentOutcome"];
  },
  "Legal Outcome": (e, raw) => {
    e.legalOutcome = raw as Entry["legalOutcome"];
  },
  "Time (0.25 increments)": (e, raw) => {
    e.timeSpent = Number(raw) || 0;
  },
};

/**
 * The two notes, in place of the log's single merged column. The log squashes
 * them together; the tab has to keep them apart, or the console could not tell
 * a visitor's note from one written for staff only.
 */
const NOTE_COLUMNS: readonly Column[] = [
  [
    "Notes",
    (e) => e.note,
    (e, raw) => {
      e.note = raw;
    },
    ["note"],
  ],
  [
    "Staff Notes",
    (e) => e.adminNote,
    (e, raw) => {
      e.adminNote = raw;
    },
    ["adminNote"],
  ],
];

/**
 * The bookkeeping the human log has no column for, written to the right of it.
 * Without these the spreadsheet could not round-trip an entry.
 */
const STATE_COLUMNS: readonly Column[] = [
  [
    "ID",
    (e) => e.id,
    (e, raw) => {
      e.id = Number(raw);
    },
    ["id"],
  ],
  [
    "Status",
    (e) => e.status,
    (e, raw) => {
      e.status = isStatus(raw) ? raw : "new";
    },
    ["status"],
  ],
  [
    "Signed In",
    (e) => toStamp(e.createdAt),
    (e, raw) => {
      e.createdAt = fromStamp(raw);
    },
    ["createdAt"],
  ],
  [
    "Last Changed",
    (e) => toStamp(e.updatedAt),
    (e, raw) => {
      e.updatedAt = fromStamp(raw);
    },
    ["updatedAt"],
  ],
  [
    "Helped By",
    (e) => e.helpedBy,
    (e, raw) => {
      e.helpedBy = raw;
    },
    ["helpedBy"],
  ],
  [
    "Priority",
    (e) => e.priority,
    (e, raw) => {
      e.priority = isPriority(raw) ? raw : DEFAULT_PRIORITY;
    },
    ["priority"],
  ],
  [
    "Appointment Time",
    (e) => toStamp(e.scheduledFor),
    (e, raw) => {
      e.scheduledFor = fromStamp(raw);
    },
    ["scheduledFor"],
  ],
];

const COLUMNS: readonly Column[] = [
  ...LOG_COLUMNS.flatMap(([header, read]): Column[] =>
    // The log's merged Notes column would repeat, cell for cell, what the two
    // note columns already hold.
    header === "Notes"
      ? [...NOTE_COLUMNS]
      : [[header, read, LOG_SETTERS[header] ?? null]],
  ),
  ...STATE_COLUMNS,
];

// A renamed log column would otherwise silently stop being read back.
for (const [header] of LOG_COLUMNS) {
  if (!(header in LOG_SETTERS)) {
    throw new Error(`No sheet reader for log column "${header}".`);
  }
}

function blankEntry(): Entry {
  return {
    id: 0,
    name: "",
    note: "",
    status: "new",
    createdAt: "",
    updatedAt: "",
    helpedBy: "",
    adminNote: "",
    dob: "",
    gender: "",
    phone: "",
    caseType: "",
    appointmentType: "",
    appointmentOutcome: "",
    legalOutcome: "",
    timeSpent: 0,
    priority: DEFAULT_PRIORITY,
    scheduledFor: "",
  };
}

/** The header row plus one row per entry, in the tab's column order. */
export function toSheetValues(entries: Entry[]): Cell[][] {
  return [
    COLUMNS.map(([header]) => header),
    ...entries.map((entry) => COLUMNS.map(([, read]) => read(entry))),
  ];
}

/**
 * Entries as read back from the tab, keyed by header rather than position, so
 * a column inserted by hand does not shift the fields this reads.
 *
 * Reading is the tolerant half. Writing is not: `toSheetValues` emits the
 * canonical column order over the whole range, so a column someone adds by
 * hand is overwritten by the next queue change. The sheet is the app's to
 * rewrite; it is not a document to keep your own columns in.
 *
 * Rows without a numeric id are skipped, which lets staff leave notes or
 * blank lines in the sheet without breaking the queue.
 *
 * Headers the columns used to go by are still accepted, so a sheet written
 * before they were renamed keeps being read until the next write renames it.
 */
export function fromSheetValues(values: Cell[][]): Entry[] {
  const [header, ...rows] = values;
  if (!header) return [];

  const readers = header.map((name) => {
    const found = String(name);
    const column = COLUMNS.find(
      ([candidate, , , aliases]) =>
        candidate === found || aliases?.includes(found),
    );
    return column?.[2] ?? null;
  });

  const entries: Entry[] = [];
  for (const row of rows) {
    const entry = blankEntry();
    readers.forEach((set, index) => {
      if (set) set(entry, String(row[index] ?? ""));
    });
    if (Number.isInteger(entry.id) && entry.id > 0) entries.push(entry);
  }
  return entries;
}

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
