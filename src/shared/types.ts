import type {
  AppointmentOutcome,
  AppointmentType,
  CaseType,
  Gender,
  LegalOutcome,
} from "../../server/shared/codes";
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
 * resolved so the exports and API keep their existing meaning.
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
    /** When staff took it off the board, or "" while it is still on it. */
    deletedAt: string;
  };

/** The join response carries the visitor's own full name, unshortened. */
export type JoinedEntry = QueueEntry & { name: string };

export type StaffRole = "owner" | "staff";

export type StaffMember = {
  email: string;
  role: StaffRole;
  addedBy: string;
  addedAt: string;
};

export type StaffList = {
  you: { email: string; role: StaffRole } | null;
  /** Owners set in the server's environment; not removable from the console. */
  bootstrapOwners: string[];
  /** Those of them that also carry a staff-tab row, which grants nothing. */
  redundantRows: string[];
  members: StaffMember[];
};
