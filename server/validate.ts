import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_TYPES,
  CASE_TYPES,
  GENDERS,
  isCode,
  isTimeSpent,
  LEGAL_OUTCOMES,
  TIME_MAX,
} from "./codes.js";
import {
  DEFAULT_PRIORITY,
  isPriority,
  isStatus,
  type Booking,
  type EntryUpdate,
  type Intake,
} from "./db.js";

export const MAX_NAME = 80;
export const MAX_NOTE = 280;
export const MAX_ADMIN_NOTE = 500;
export const MAX_PHONE = 30;

/**
 * A parsed value, or the message to send back as a 400.
 * Handlers read input, check it, and act — no route decides for itself what
 * counts as a valid name, which is how the two create paths once drifted into
 * rejecting and silently truncating the same over-length field.
 */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (error: string): Checked<never> => ({ ok: false, error });

const trimmed = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/** Blank, or the ISO calendar date an <input type="date"> submits. */
export function isDob(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Round-tripping rejects real-looking impossibilities like 2026-02-31.
  if (date.toISOString().slice(0, 10) !== value) return false;
  return date.getTime() <= Date.now();
}

/**
 * Blank, or a timestamp normalized to ISO.
 * Returns undefined for junk. Normalizing at the edge matters: the queue
 * orders by comparing these strings, so a stored "Aug 17, 2026 2:00 PM" would
 * sort against ISO timestamps by raw text and land anywhere.
 *
 * A four-digit year is required rather than left to `new Date`, which coerces
 * "5" into a real timestamp in 2001 — a booking that would then sort ahead of
 * every walk-in on the board. Anything else a human might type is still
 * accepted and normalized.
 */
export function normalizeScheduledFor(value: string): string | undefined {
  if (value === "") return "";
  if (!/\d{4}/.test(value)) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function checkLength(
  value: string,
  max: number,
  label: string,
): Checked<string> {
  if (value.length > max) {
    return bad(`${label} must be ${max} characters or fewer.`);
  }
  return ok(value);
}

export type NewEntry = { name: string; note: string; intake: Intake };

/**
 * The person and their intake details — everything both create paths share,
 * so a visitor signing themselves in and staff booking them are held to the
 * same rules.
 */
export function checkNewEntry(body: unknown): Checked<NewEntry> {
  const input = (body ?? {}) as Record<string, unknown>;

  // A number or null would otherwise be trimmed away to "", storing a blank
  // phone for a client who supplied one. checkUpdate already rejects these.
  for (const [field, label] of [
    ["name", "Name"],
    ["note", "Note"],
    ["dob", "Date of birth"],
    ["gender", "Gender"],
    ["phone", "Phone"],
    ["caseType", "Case type"],
  ] as const) {
    const value = input[field];
    if (value !== undefined && typeof value !== "string") {
      return bad(`${label} must be text.`);
    }
  }

  const name = trimmed(input.name);
  if (!name) return bad("Name is required.");

  const lengths: [string, number, string][] = [
    [name, MAX_NAME, "Name"],
    [trimmed(input.note), MAX_NOTE, "Note"],
    [trimmed(input.phone), MAX_PHONE, "Phone"],
  ];
  for (const [value, max, label] of lengths) {
    const checked = checkLength(value, max, label);
    if (!checked.ok) return checked;
  }

  const dob = trimmed(input.dob);
  if (!isDob(dob)) return bad("Date of birth must be a past date.");

  const gender = trimmed(input.gender);
  if (!isCode(GENDERS, gender)) return bad("Unknown gender.");

  const caseType = trimmed(input.caseType);
  if (!isCode(CASE_TYPES, caseType)) return bad("Unknown case type.");

  return ok({
    name,
    note: trimmed(input.note),
    intake: {
      dob,
      gender,
      phone: trimmed(input.phone),
      caseType,
    },
  });
}

/** Triage level and appointment time — the staff-only half of a booking. */
export function checkBooking(body: unknown): Checked<Booking> {
  const input = (body ?? {}) as Record<string, unknown>;
  const priority = input.priority ?? DEFAULT_PRIORITY;
  if (!isPriority(priority)) return bad("Unknown triage level.");

  const scheduledFor = normalizeScheduledFor(trimmed(input.scheduledFor));
  if (scheduledFor === undefined) {
    return bad("Appointment time is not a valid date.");
  }
  return ok({ priority, scheduledFor });
}

/**
 * A partial update. Absent keys are left alone; a key present but blank
 * clears that field, which is how staff unset a coded value.
 */
export function checkUpdate(body: unknown): Checked<EntryUpdate> {
  const input = (body ?? {}) as Record<string, unknown>;
  const {
    status,
    helpedBy,
    adminNote,
    timeSpent,
    priority,
    scheduledFor,
    dob,
  } = input;

  // Each coded field is blank until staff pick a value, so "unset" has to
  // mean the key was absent, not that it arrived empty.
  const coded = [
    ["gender", GENDERS, "gender"],
    ["caseType", CASE_TYPES, "case type"],
    ["appointmentType", APPOINTMENT_TYPES, "appointment type"],
    ["appointmentOutcome", APPOINTMENT_OUTCOMES, "appointment outcome"],
    ["legalOutcome", LEGAL_OUTCOMES, "legal outcome"],
  ] as const;

  const touched =
    [status, helpedBy, adminNote, timeSpent, priority, scheduledFor, dob].some(
      (value) => value !== undefined,
    ) ||
    input.phone !== undefined ||
    coded.some(([field]) => input[field] !== undefined);
  if (!touched) return bad("Nothing to update.");

  const update: EntryUpdate = {};

  if (status !== undefined) {
    if (!isStatus(status)) {
      return bad("Status must be new, pending, or resolved.");
    }
    update.status = status;
  }

  if (dob !== undefined) {
    if (typeof dob !== "string" || !isDob(dob.trim())) {
      return bad("Date of birth must be a past date.");
    }
    update.dob = dob.trim();
  }

  for (const [field, max, label] of [
    ["helpedBy", MAX_NAME, "Helped by"],
    ["adminNote", MAX_ADMIN_NOTE, "Admin note"],
    ["phone", MAX_PHONE, "Phone"],
  ] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return bad(`${label} must be text.`);
    const checked = checkLength(value.trim(), max, label);
    if (!checked.ok) return checked;
    update[field] = checked.value;
  }

  for (const [field, codes, label] of coded) {
    const value = input[field];
    if (value === undefined) continue;
    if (!isCode(codes, value)) return bad(`Unknown ${label}.`);
    // Narrowed by isCode against this field's own code list.
    Object.assign(update, { [field]: value });
  }

  if (timeSpent !== undefined) {
    if (!isTimeSpent(timeSpent)) {
      return bad(`Time must be a multiple of 0.25 between 0 and ${TIME_MAX}.`);
    }
    update.timeSpent = timeSpent;
  }

  if (priority !== undefined) {
    if (!isPriority(priority)) return bad("Unknown triage level.");
    update.priority = priority;
  }

  if (scheduledFor !== undefined) {
    const at =
      typeof scheduledFor === "string"
        ? normalizeScheduledFor(scheduledFor.trim())
        : undefined;
    if (at === undefined) {
      return bad("Appointment time is not a valid date.");
    }
    update.scheduledFor = at;
  }

  return ok(update);
}
