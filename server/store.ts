import { LOG_COLUMNS } from "./csv.js";
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
 * The bookkeeping the human log has no column for, written to the right of it.
 * Without these the spreadsheet could not round-trip an entry.
 */
const STATE_COLUMNS: readonly [string, (e: Entry) => Cell, Setter][] = [
  [
    "id",
    (e) => e.id,
    (e, raw) => {
      e.id = Number(raw);
    },
  ],
  [
    "status",
    (e) => e.status,
    (e, raw) => {
      e.status = isStatus(raw) ? raw : "new";
    },
  ],
  [
    "createdAt",
    (e) => e.createdAt,
    (e, raw) => {
      e.createdAt = raw;
    },
  ],
  [
    "updatedAt",
    (e) => e.updatedAt,
    (e, raw) => {
      e.updatedAt = raw;
    },
  ],
  [
    "helpedBy",
    (e) => e.helpedBy,
    (e, raw) => {
      e.helpedBy = raw;
    },
  ],
  [
    "note",
    (e) => e.note,
    (e, raw) => {
      e.note = raw;
    },
  ],
  [
    "adminNote",
    (e) => e.adminNote,
    (e, raw) => {
      e.adminNote = raw;
    },
  ],
  [
    "priority",
    (e) => e.priority,
    (e, raw) => {
      e.priority = isPriority(raw) ? raw : DEFAULT_PRIORITY;
    },
  ],
  [
    "scheduledFor",
    (e) => e.scheduledFor,
    (e, raw) => {
      e.scheduledFor = raw;
    },
  ],
];

const COLUMNS: readonly [string, (e: Entry) => Cell, Setter | null][] = [
  ...LOG_COLUMNS.map(
    ([header, read]) =>
      [header, read, LOG_SETTERS[header] ?? null] as [
        string,
        (e: Entry) => Cell,
        Setter | null,
      ],
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
 */
export function fromSheetValues(values: Cell[][]): Entry[] {
  const [header, ...rows] = values;
  if (!header) return [];

  const readers = header.map((name) => {
    const column = COLUMNS.find(([candidate]) => candidate === String(name));
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
  clear(): Promise<number>;
};

/**
 * The queue, kept in the clinic's spreadsheet.
 *
 * Every write rewrites the whole tab, and reads are served from a short-lived
 * cache so the five-second polling of the board and the console does not
 * spend the Sheets read quota.
 */
export function createStore(transport: SheetTransport): Store {
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

  /** Runs a read-modify-write against the freshest copy of the tab. */
  function change<T>(mutate: (entries: Entry[]) => Promise<T> | T): Promise<T> {
    const run = queue.then(async () => {
      // Never from cache: a write must not be built on a stale read.
      cache = null;
      return mutate(await load());
    });
    // Keep the chain alive even when this caller's write fails.
    queue = run.catch(() => {});
    return run;
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

    clear() {
      return change(async (entries) => {
        await save([]);
        return entries.length;
      });
    },
  };
}
