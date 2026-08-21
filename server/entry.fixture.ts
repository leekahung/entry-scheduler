import type { Entry } from "./entry.js";

/** A complete entry with neutral defaults, for tests that need one to hand. */
export const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 1,
  name: "Ada",
  note: "",
  status: "new",
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z",
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
  priority: "routine",
  scheduledFor: "",
  ...overrides,
});
