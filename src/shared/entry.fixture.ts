import type { AdminEntry } from "./types";

/** A complete admin entry with neutral defaults, for tests that need one. */
export const makeAdminEntry = (
  overrides: Partial<AdminEntry> = {},
): AdminEntry => ({
  id: 1,
  name: "Ada Lovelace",
  note: "",
  status: "new",
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z",
  due: true,
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
  visitType: "in-person",
  deletedAt: "",
  scheduledFor: "",
  ...overrides,
});
