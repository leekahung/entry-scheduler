import { LOG_COLUMNS } from "./log.js";
import { fromStamp, toStamp } from "./stamp.js";
import {
  DEFAULT_PRIORITY,
  isPriority,
  isStatus,
  type Entry,
} from "../domain/entry.js";
import type { Gender, CaseType } from "../shared/codes.js";

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
  [
    "Removed At",
    (e) => toStamp(e.deletedAt),
    (e, raw) => {
      e.deletedAt = fromStamp(raw);
    },
    ["deletedAt"],
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

export function blankEntry(): Entry {
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
    deletedAt: "",
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
