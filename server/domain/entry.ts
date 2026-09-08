import type {
  AppointmentOutcome,
  AppointmentType,
  CaseType,
  Gender,
  LegalOutcome,
} from "../shared/codes.js";

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
  /**
   * When staff took this entry off the board, or "" while it is still on it.
   * Removal is reversible, so the row stays where it is and every view that
   * describes the clinic's work filters it out instead.
   */
  deletedAt: string;
};

/** Whether staff have taken this entry off the board. */
export function isRemoved(entry: Entry): boolean {
  return Boolean(entry.deletedAt);
}

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

/** Triage and appointment time, which only staff can set. */
export type Booking = {
  priority: Priority;
  scheduledFor: string;
};

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

export const UPDATABLE = [
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
