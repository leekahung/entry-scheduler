import Database from "better-sqlite3";
import type {
  AppointmentOutcome,
  AppointmentType,
  CaseType,
  Gender,
  LegalOutcome,
} from "./codes.js";

export const STATUSES = ["new", "pending", "resolved"] as const;
export type Status = (typeof STATUSES)[number];

/** Triage levels, most urgent first — this array's order is the queue order. */
export const PRIORITIES = ["emergency", "urgent", "routine"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const DEFAULT_PRIORITY: Priority = "routine";

export type Entry = {
  id: number;
  name: string;
  note: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  helpedBy: string;
  /** Staff-only; never included in the public queue. */
  adminNote: string;
  // --- Intake fields, given by the visitor at sign-in. ---
  dob: string;
  gender: Gender | "";
  phone: string;
  caseType: CaseType | "";
  // --- Case fields, filled in by staff as the appointment progresses. ---
  appointmentType: AppointmentType | "";
  appointmentOutcome: AppointmentOutcome | "";
  legalOutcome: LegalOutcome | "";
  /** Billable hours in quarter-hour steps, matching the log's Time column. */
  timeSpent: number;
  /** Staff-assigned triage level; visitors never set their own. */
  priority: Priority;
  /** Booked appointment time, or "" for a walk-in. */
  scheduledFor: string;
};

/**
 * When someone joins the single shared line: their appointment time if they
 * have one, otherwise when they walked in.
 */
export function queuedFrom(entry: Entry): string {
  return entry.scheduledFor || entry.createdAt;
}

/** A walk-in is due on arrival; an appointment is due at its start time. */
export function isDue(entry: Entry, now: number): boolean {
  if (!entry.scheduledFor) return true;
  const at = new Date(entry.scheduledFor).getTime();
  return Number.isNaN(at) || at <= now;
}

/**
 * Queue order — triage level first, then whoever has been due longest, so a
 * 2pm booking falls in behind the morning walk-ins and ahead of anyone
 * arriving after 2pm.
 *
 * Triage only sorts people who are actually due. An appointment still hours
 * out waits at the back whatever its level, or the board would announce
 * someone who has not walked through the door yet as next up.
 */
export function queueOrder(now = Date.now()) {
  return (a: Entry, b: Entry): number => {
    const dueA = isDue(a, now);
    if (dueA !== isDue(b, now)) return dueA ? -1 : 1;

    const level = dueA
      ? PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)
      : 0;
    if (level !== 0) return level;
    return queuedFrom(a).localeCompare(queuedFrom(b)) || a.id - b.id;
  };
}

/** What a visitor supplies at sign-in, beyond their name and note. */
export type Intake = {
  dob: string;
  gender: Gender | "";
  phone: string;
  caseType: CaseType | "";
};

export function isStatus(value: unknown): value is Status {
  return (
    typeof value === "string" && (STATUSES as readonly string[]).includes(value)
  );
}

export function isPriority(value: unknown): value is Priority {
  return (
    typeof value === "string" &&
    (PRIORITIES as readonly string[]).includes(value)
  );
}

/**
 * Opens the queue database and creates the entries table if missing.
 * Pass ":memory:" for tests.
 */
export function openDb(file: string) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','pending','resolved')),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      helpedBy TEXT NOT NULL DEFAULT '',
      adminNote TEXT NOT NULL DEFAULT '',
      dob TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      caseType TEXT NOT NULL DEFAULT '',
      appointmentType TEXT NOT NULL DEFAULT '',
      appointmentOutcome TEXT NOT NULL DEFAULT '',
      legalOutcome TEXT NOT NULL DEFAULT '',
      timeSpent REAL NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'routine',
      scheduledFor TEXT NOT NULL DEFAULT ''
    )
  `);

  // Add columns introduced after a database was first created.
  const columns = new Set(
    (
      db.prepare("SELECT name FROM pragma_table_info('entries')").all() as {
        name: string;
      }[]
    ).map((column) => column.name),
  );
  for (const [name, ddl] of [
    ["adminNote", "TEXT NOT NULL DEFAULT ''"],
    ["dob", "TEXT NOT NULL DEFAULT ''"],
    ["gender", "TEXT NOT NULL DEFAULT ''"],
    ["phone", "TEXT NOT NULL DEFAULT ''"],
    ["caseType", "TEXT NOT NULL DEFAULT ''"],
    ["appointmentType", "TEXT NOT NULL DEFAULT ''"],
    ["appointmentOutcome", "TEXT NOT NULL DEFAULT ''"],
    ["legalOutcome", "TEXT NOT NULL DEFAULT ''"],
    ["timeSpent", "REAL NOT NULL DEFAULT 0"],
    ["priority", "TEXT NOT NULL DEFAULT 'routine'"],
    ["scheduledFor", "TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE entries ADD COLUMN ${name} ${ddl}`);
    }
  }

  return db;
}

export type Db = ReturnType<typeof openDb>;

/** Triage and appointment time, which only staff can set. */
export type Booking = {
  priority: Priority;
  scheduledFor: string;
};

export function addEntry(
  db: Db,
  name: string,
  note: string,
  intake: Intake = { dob: "", gender: "", phone: "", caseType: "" },
  booking: Booking = { priority: DEFAULT_PRIORITY, scheduledFor: "" },
): Entry {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO entries
        (name, note, status, createdAt, updatedAt, dob, gender, phone, caseType, priority, scheduledFor)
        VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      note,
      now,
      now,
      intake.dob,
      intake.gender,
      intake.phone,
      intake.caseType,
      booking.priority,
      booking.scheduledFor,
    );
  return getEntry(db, Number(lastInsertRowid)) as Entry;
}

export function getEntry(db: Db, id: number): Entry | undefined {
  return db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as
    | Entry
    | undefined;
}

export function listEntries(db: Db): Entry[] {
  return db.prepare("SELECT * FROM entries ORDER BY id ASC").all() as Entry[];
}

export type EntryUpdate = {
  status?: Status;
  helpedBy?: string;
  adminNote?: string;
  dob?: string;
  gender?: Gender | "";
  phone?: string;
  caseType?: CaseType | "";
  priority?: Priority;
  scheduledFor?: string;
  appointmentType?: AppointmentType | "";
  appointmentOutcome?: AppointmentOutcome | "";
  legalOutcome?: LegalOutcome | "";
  timeSpent?: number;
};

const UPDATABLE = [
  "helpedBy",
  "adminNote",
  "dob",
  "gender",
  "phone",
  "caseType",
  "priority",
  "scheduledFor",
  "appointmentType",
  "appointmentOutcome",
  "legalOutcome",
  "timeSpent",
] as const satisfies readonly (keyof EntryUpdate)[];

/**
 * Applies a partial update; omitted fields keep their current value.
 * Returns undefined if the id is unknown.
 */
export function updateEntry(
  db: Db,
  id: number,
  update: EntryUpdate,
): Entry | undefined {
  const existing = getEntry(db, id);
  if (!existing) return undefined;

  const merged: Record<string, string | number> = {};
  for (const field of UPDATABLE) {
    merged[field] = update[field] ?? existing[field];
  }
  merged.status = update.status ?? existing.status;
  // Only an explicit reopen clears the claim. Keying off the resolved status
  // would also wipe a name typed onto an entry that is merely still waiting.
  if (update.status === "new") merged.helpedBy = "";

  const fields = [...UPDATABLE, "status"];
  db.prepare(
    `UPDATE entries SET ${fields.map((f) => `${f} = ?`).join(", ")}, updatedAt = ? WHERE id = ?`,
  ).run(...fields.map((f) => merged[f]), new Date().toISOString(), id);

  return getEntry(db, id);
}

export function deleteEntry(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM entries WHERE id = ?").run(id).changes > 0;
}

/**
 * Empties the queue and restarts numbering at #1, for starting a fresh day.
 * Returns how many entries were removed.
 */
export function clearEntries(db: Db): number {
  const removed = db.prepare("DELETE FROM entries").run().changes;
  // AUTOINCREMENT keeps its high-water mark in sqlite_sequence; clear it so
  // the next visitor is #1 again rather than continuing from yesterday.
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'entries'").run();
  return removed;
}
