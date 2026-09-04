import type {
  AdminEntry,
  CaseDetails,
  Intake,
  Priority,
} from "../shared/types";
import { toLocalInput } from "../shared/time";

export type EditorDraft = {
  helpedBy: string;
  adminNote: string;
  appointmentType: CaseDetails["appointmentType"];
  appointmentOutcome: CaseDetails["appointmentOutcome"];
  legalOutcome: CaseDetails["legalOutcome"];
  timeSpent: string;
  priority: Priority;
  dob: string;
  gender: Intake["gender"];
  phone: string;
  caseType: Intake["caseType"];
  scheduledFor: string;
};

/** Seeds a draft from an entry. Lives here so the shape stays with the form. */
/**
 * The editor's starting values for one entry.
 * `helper` is whoever the console is helping as, which stands in for an entry
 * nobody has claimed yet — a name already recorded is never overwritten.
 */
export function seedDraft(entry: AdminEntry, helper = ""): EditorDraft {
  return {
    helpedBy: entry.helpedBy || helper,
    adminNote: entry.adminNote,
    appointmentType: entry.appointmentType,
    appointmentOutcome: entry.appointmentOutcome,
    legalOutcome: entry.legalOutcome,
    // Kept as typed: "1." is momentarily unparseable, and coercing it to a
    // number here would rewrite the field to 0 before the user reached "1.5".
    timeSpent: String(entry.timeSpent),
    priority: entry.priority,
    dob: entry.dob,
    gender: entry.gender,
    phone: entry.phone,
    caseType: entry.caseType,
    // Held in the input's local format; converted back to ISO on save.
    scheduledFor: toLocalInput(entry.scheduledFor),
  };
}
