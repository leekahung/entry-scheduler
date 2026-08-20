import { useState } from "react";
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_TYPES,
  CASE_TYPE_LABEL,
  CASE_TYPES_BY_LABEL,
  GENDERS,
  LEGAL_OUTCOME_GROUPS,
  LEGAL_OUTCOME_LABEL,
  TIME_MAX,
  TIME_STEP,
} from "../server/codes";
import {
  ADMIN_NOTE_MAX,
  PRIORITIES,
  PRIORITY_LABEL,
  type AdminEntry,
  type CaseDetails,
  type Intake,
  type Priority,
} from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { fromLocalInput, toLocalInput, todayLocal } from "./time";
import type { EntryChanges } from "./useEntries";

/** The form's own shape: every field a string or code the inputs can hold. */
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
export function seedDraft(entry: AdminEntry): EditorDraft {
  return {
    helpedBy: entry.helpedBy,
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

type Props = {
  entry: AdminEntry;
  /** Owned by the page: a row can move between tables mid-edit, which
      unmounts this component, and a draft held here would go with it. */
  draft: EditorDraft;
  initial: EditorDraft;
  onChange: (draft: EditorDraft) => void;
  onSave: (details: EntryChanges) => Promise<boolean>;
  onCancel: () => void;
};

/**
 * The expanded row editor.
 * Its draft is seeded once when the editor opens and owned by the page, so
 * neither the poll refreshing the list nor the row moving between tables can
 * overwrite half-typed changes.
 */
export default function EntryEditor({
  entry,
  draft,
  initial,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const dirty = (Object.keys(draft) as (keyof typeof draft)[]).some(
    (key) => draft[key] !== initial[key],
  );

  const handleCancel = () => (dirty ? setConfirmingCancel(true) : onCancel());

  async function handleSave() {
    setSaving(true);
    // Only what changed: this draft was seeded when the editor opened, so
    // sending untouched fields would overwrite whatever anyone else saved
    // while it sat open.
    const changes: EntryChanges = {};
    for (const key of Object.keys(draft) as (keyof EditorDraft)[]) {
      if (draft[key] === initial[key]) continue;
      if (key === "scheduledFor") {
        changes.scheduledFor = fromLocalInput(draft.scheduledFor);
      } else if (key === "timeSpent") {
        // An empty or half-typed box reads as 0 rather than NaN, which the
        // server would reject on save.
        changes.timeSpent = Number(draft.timeSpent) || 0;
      } else {
        Object.assign(changes, { [key]: draft[key] });
      }
    }
    // The caller closes the editor on success; closing it here too would
    // reopen it, since the row's toggle would see it already shut.
    await onSave(changes);
    setSaving(false);
  }

  return (
    <>
      <p className="mx-0 mt-0 mb-[0.6rem] font-bold">
        Editing #{entry.id} · {entry.name}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`dob-${entry.id}`}>
            Date of birth
          </label>
          <input
            id={`dob-${entry.id}`}
            type="date"
            value={draft.dob}
            onChange={(event) => set("dob", event.target.value)}
            max={todayLocal()}
          />
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`phone-${entry.id}`}>
            Phone number
          </label>
          <input
            id={`phone-${entry.id}`}
            type="tel"
            value={draft.phone}
            onChange={(event) => set("phone", event.target.value)}
            maxLength={30}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`gender-${entry.id}`}>
            Gender
          </label>
          <select
            id={`gender-${entry.id}`}
            value={draft.gender}
            onChange={(event) =>
              set("gender", event.target.value as Intake["gender"])
            }
          >
            <option value="">—</option>
            {GENDERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`caseType-${entry.id}`}>
            Case type
          </label>
          <select
            id={`caseType-${entry.id}`}
            value={draft.caseType}
            onChange={(event) =>
              set("caseType", event.target.value as Intake["caseType"])
            }
          >
            <option value="">—</option>
            {CASE_TYPES_BY_LABEL.map((type) => (
              <option key={type} value={type}>
                {CASE_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="my-2 block" htmlFor={`helper-${entry.id}`}>
        Helped by
      </label>
      <input
        id={`helper-${entry.id}`}
        className="mb-3 max-w-[18rem]"
        value={draft.helpedBy}
        onChange={(event) => set("helpedBy", event.target.value)}
        maxLength={80}
        placeholder="Leave blank if nobody has helped yet"
        // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit click, so focus follows intent
        autoFocus
      />

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`when-${entry.id}`}>
            Appointment time
          </label>
          <input
            id={`when-${entry.id}`}
            type="datetime-local"
            value={draft.scheduledFor}
            onChange={(event) => set("scheduledFor", event.target.value)}
          />
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`priority-${entry.id}`}>
            Triage level
          </label>
          <select
            id={`priority-${entry.id}`}
            value={draft.priority}
            onChange={(event) =>
              set("priority", event.target.value as Priority)
            }
          >
            {PRIORITIES.map((level) => (
              <option key={level} value={level}>
                {PRIORITY_LABEL[level]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`apptType-${entry.id}`}>
            Appointment type
          </label>
          <select
            id={`apptType-${entry.id}`}
            value={draft.appointmentType}
            onChange={(event) =>
              set(
                "appointmentType",
                event.target.value as CaseDetails["appointmentType"],
              )
            }
          >
            <option value="">—</option>
            {APPOINTMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`apptOutcome-${entry.id}`}>
            Appointment outcome
          </label>
          <select
            id={`apptOutcome-${entry.id}`}
            value={draft.appointmentOutcome}
            onChange={(event) =>
              set(
                "appointmentOutcome",
                event.target.value as CaseDetails["appointmentOutcome"],
              )
            }
          >
            <option value="">—</option>
            {APPOINTMENT_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`legalOutcome-${entry.id}`}>
            Legal outcome
          </label>
          <select
            id={`legalOutcome-${entry.id}`}
            value={draft.legalOutcome}
            onChange={(event) =>
              set(
                "legalOutcome",
                event.target.value as CaseDetails["legalOutcome"],
              )
            }
          >
            <option value="">—</option>
            {LEGAL_OUTCOME_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.codes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {LEGAL_OUTCOME_LABEL[outcome]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label className="my-2 block" htmlFor={`time-${entry.id}`}>
            Time (hours, 0.25 steps)
          </label>
          <input
            id={`time-${entry.id}`}
            type="number"
            value={draft.timeSpent}
            onChange={(event) => set("timeSpent", event.target.value)}
            min={0}
            max={TIME_MAX}
            step={TIME_STEP}
          />
        </div>
      </div>

      <label className="my-2 block" htmlFor={`note-${entry.id}`}>
        Admin note
      </label>
      <textarea
        id={`note-${entry.id}`}
        className="max-w-[44rem]"
        value={draft.adminNote}
        onChange={(event) =>
          set("adminNote", event.target.value.slice(0, ADMIN_NOTE_MAX))
        }
        maxLength={ADMIN_NOTE_MAX}
        rows={3}
        placeholder="Only staff can see this."
      />
      <div className="mt-2 flex max-w-[44rem] flex-wrap items-center justify-end gap-2 card-mode:justify-stretch">
        <span className="mr-auto text-left text-[0.8rem] text-muted card-mode:mr-0 card-mode:mb-1 card-mode:flex-[1_0_100%]">
          {ADMIN_NOTE_MAX - draft.adminNote.length} characters left
        </span>
        <button
          type="button"
          className="border-border bg-surface text-text card-mode:flex-1"
          onClick={handleCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="card-mode:flex-1"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmingCancel}
        title="Discard your changes?"
        body={`The edits to #${entry.id} have not been saved yet. Closing now throws them away.`}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmingCancel(false);
          onCancel();
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
    </>
  );
}
