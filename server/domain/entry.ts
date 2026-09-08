import type {
  AppointmentOutcome,
  AppointmentType,
  CaseType,
  Gender,
  LegalOutcome,
} from "../shared/codes.js";

export const STATUSES = ["new", "pending", "resolved"] as const;
export type Status = (typeof STATUSES)[number];

/** How the clinic is meeting someone: in the room, or at a distance. */
export const VISIT_TYPES = ["in-person", "remote"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];
export const DEFAULT_VISIT_TYPE: VisitType = "in-person";

/**
 * Tie-break rank, lowest first. Separate from VISIT_TYPES, which is the order
 * the dropdowns offer — the two need not agree, and here they do not.
 */
const VISIT_TYPE_RANK: Record<VisitType, number> = {
  remote: 0,
  "in-person": 1,
};

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
  /** Staff-assigned; visitors never set their own. */
  visitType: VisitType;
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
 * Queue order — whoever has been due longest, so a 2pm booking falls in behind
 * the morning walk-ins and ahead of anyone arriving after 2pm.
 *
 * An appointment still hours out waits at the back whatever its visit type, or
 * the board would announce someone who has not walked through the door yet as
 * next up.
 *
 * Visit type only separates two entries due at the same moment, where it puts
 * remote first. Ranking above the due time instead would hold a walk-in behind
 * every remote entry, including ones raised after they arrived.
 */
export function queueOrder(now = Date.now()) {
  return (a: Entry, b: Entry): number => {
    const dueA = isDue(a, now);
    if (dueA !== isDue(b, now)) return dueA ? -1 : 1;

    const waited = queuedFrom(a).localeCompare(queuedFrom(b));
    if (waited !== 0) return waited;

    const rank = dueA
      ? VISIT_TYPE_RANK[a.visitType] - VISIT_TYPE_RANK[b.visitType]
      : 0;
    return rank || a.id - b.id;
  };
}

/** What a visitor supplies at sign-in, beyond their name and note. */
export type Intake = {
  dob: string;
  gender: Gender | "";
  phone: string;
  caseType: CaseType | "";
};

/** Visit type, appointment time and helper, which only staff can set. */
export type Booking = {
  visitType: VisitType;
  scheduledFor: string;
  helpedBy: string;
};

export type EntryUpdate = {
  status?: Status;
  helpedBy?: string;
  adminNote?: string;
  dob?: string;
  gender?: Gender | "";
  phone?: string;
  caseType?: CaseType | "";
  visitType?: VisitType;
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
  "visitType",
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

export function isVisitType(value: unknown): value is VisitType {
  return (
    typeof value === "string" &&
    (VISIT_TYPES as readonly string[]).includes(value)
  );
}
