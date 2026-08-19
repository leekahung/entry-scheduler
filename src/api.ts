import { todayLocal } from "./time";
import type {
  AppointmentOutcome,
  AppointmentType,
  CaseType,
  Gender,
  LegalOutcome,
} from "../server/codes";

export const STATUSES = ["new", "pending", "resolved"] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["emergency", "urgent", "routine"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Short labels for the triage control; staff read these at a glance. */
export const PRIORITY_LABEL: Record<Priority, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  routine: "Routine",
};

/**
 * Plain-English labels for the screen. The stored values stay new/pending/
 * resolved so the CSV and API keep their existing meaning.
 */
export const STATUS_LABEL: Record<Status, string> = {
  new: "Waiting",
  pending: "Being helped",
  resolved: "Done",
};

export type QueueEntry = {
  id: number;
  /** Shortened for the shared screen — "Ada L.", never the full legal name. */
  name: string;
  status: Status;
  createdAt: string;
  /** Booked appointment time, or "" for a walk-in. */
  scheduledFor: string;
  /**
   * Whether this entry has joined the line yet — always true for a walk-in,
   * true for an appointment once its time arrives. Decided by the server so
   * the board and the queue order can never disagree.
   */
  due: boolean;
};

/** The visitor-supplied half of the sign-in log row. */
export type Intake = {
  dob: string;
  gender: Gender | "";
  phone: string;
  caseType: CaseType | "";
};

/** The part of the intake a visitor fills in themselves; staff add the rest. */
export type VisitorIntake = Omit<Intake, "caseType">;

/** The half staff fill in as the appointment happens. */
export type CaseDetails = {
  appointmentType: AppointmentType | "";
  appointmentOutcome: AppointmentOutcome | "";
  legalOutcome: LegalOutcome | "";
  timeSpent: number;
};

export type AdminEntry = QueueEntry &
  Intake &
  CaseDetails & {
    note: string;
    updatedAt: string;
    helpedBy: string;
    adminNote: string;
    priority: Priority;
  };

/** The join response carries the visitor's own full name, unshortened. */
export type JoinedEntry = QueueEntry & { name: string };

export const ADMIN_NOTE_MAX = 500;

/** A failed request, carrying the status so 401 and 429 can be told apart. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      body?.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

const adminHeaders = (passcode: string) => ({
  "Content-Type": "application/json",
  "x-admin-passcode": passcode,
});

export async function joinQueue(
  name: string,
  intake: VisitorIntake,
): Promise<JoinedEntry> {
  return parse<JoinedEntry>(
    await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...intake }),
    }),
  );
}

export async function fetchQueue(): Promise<QueueEntry[]> {
  return parse<QueueEntry[]>(await fetch("/api/queue"));
}

/** Staff booking someone in, with an appointment time or as a walk-up. */
export async function bookEntry(
  passcode: string,
  booking: {
    name: string;
    note: string;
    scheduledFor: string;
    priority: Priority;
  } & Intake,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch("/api/admin/entries", {
      method: "POST",
      headers: adminHeaders(passcode),
      body: JSON.stringify(booking),
    }),
  );
}

/** Empties the queue and restarts numbering at #1. Admin only. */
export async function clearAllEntries(passcode: string): Promise<number> {
  const body = await parse<{ removed: number }>(
    await fetch("/api/entries", {
      method: "DELETE",
      headers: adminHeaders(passcode),
    }),
  );
  return body.removed;
}

export type PasscodeResult = {
  accepted: boolean;
  /** Server-side lockout, not a verdict on the passcode itself. */
  lockedOut: boolean;
  /** Tries left before lockout, or null if the server didn't say. */
  remaining: number | null;
};

/**
 * Checks a passcode without throwing on rejection.
 * Rejects only when the server is unreachable, so callers can tell a bad
 * passcode apart from a network blip.
 */
export async function verifyPasscode(
  passcode: string,
): Promise<PasscodeResult> {
  const res = await fetch("/api/admin/verify", {
    method: "POST",
    headers: adminHeaders(passcode),
  });
  const remaining = res.headers.get("ratelimit-remaining");
  return {
    accepted: res.ok,
    lockedOut: res.status === 429,
    remaining: remaining === null ? null : Number(remaining),
  };
}

export type AdminAlerts = {
  failedAttempts: number;
  lastAttemptAt: string | null;
  windowMinutes: number;
};

/** Failed sign-in attempts, so the console can warn staff someone is probing. */
export async function fetchAdminAlerts(passcode: string): Promise<AdminAlerts> {
  return parse<AdminAlerts>(
    await fetch("/api/admin/alerts", { headers: adminHeaders(passcode) }),
  );
}

export async function fetchAllEntries(passcode: string): Promise<AdminEntry[]> {
  return parse<AdminEntry[]>(
    await fetch("/api/entries", { headers: adminHeaders(passcode) }),
  );
}

export async function updateStatus(
  passcode: string,
  id: number,
  status: Status,
  helpedBy: string,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch(`/api/entries/${id}`, {
      method: "PATCH",
      headers: adminHeaders(passcode),
      // Omit a blank name so an unset "Helping as" never wipes an existing one.
      body: JSON.stringify({ status, ...(helpedBy ? { helpedBy } : {}) }),
    }),
  );
}

/**
 * Saves the per-entry fields an admin can correct after the fact.
 * Partial for the same reason as updatePriority below: the editor's draft is
 * seeded when it opens, so sending every field would push minutes-old values
 * back over whatever another admin changed in the meantime.
 */
export async function updateDetails(
  passcode: string,
  id: number,
  details: Partial<
    {
      helpedBy: string;
      adminNote: string;
      priority: Priority;
      scheduledFor: string;
    } & Intake &
      CaseDetails
  >,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch(`/api/entries/${id}`, {
      method: "PATCH",
      headers: adminHeaders(passcode),
      body: JSON.stringify(details),
    }),
  );
}

/** Patches only the triage level. */
export async function updatePriority(
  passcode: string,
  id: number,
  priority: Priority,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch(`/api/entries/${id}`, {
      method: "PATCH",
      headers: adminHeaders(passcode),
      body: JSON.stringify({ priority }),
    }),
  );
}

export async function deleteEntry(passcode: string, id: number): Promise<void> {
  const res = await fetch(`/api/entries/${id}`, {
    method: "DELETE",
    headers: adminHeaders(passcode),
  });
  if (!res.ok) {
    throw new ApiError(`Could not delete entry (${res.status})`, res.status);
  }
}

/** Downloads the CSV export through an object URL so the passcode header is sent. */
export async function downloadCsv(passcode: string): Promise<void> {
  const res = await fetch("/api/entries.csv", {
    headers: adminHeaders(passcode),
  });
  if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `entries-${todayLocal()}.csv`;
  // Firefox and Safari need the link in the document, and revoking the URL
  // synchronously can abort the download before it commits.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * What the processing log still needs before this client counts as recorded.
 * Legal outcome is deliberately not required: a consult that files nothing is
 * still a complete record.
 */
export function missingForLog(entry: AdminEntry): string[] {
  const missing: string[] = [];
  if (!entry.caseType) missing.push("case type");
  if (!entry.appointmentType) missing.push("appointment type");
  if (!entry.appointmentOutcome) missing.push("appointment outcome");
  if (!entry.timeSpent) missing.push("time spent");
  return missing;
}
