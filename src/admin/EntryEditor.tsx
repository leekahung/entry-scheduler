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
} from "../../server/shared/codes";
import { MAX_ADMIN_NOTE, MAX_NAME } from "../../server/shared/limits";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  type AdminEntry,
  type CaseDetails,
  type Priority,
} from "../shared/types";
import ConfirmDialog from "./ConfirmDialog";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { CodeSelect, DobField, PhoneField } from "../shared/fields";
import { fromLocalInput } from "../shared/time";
import type { EntryChanges } from "../hooks/useEntries";

/** The form's own shape: every field a string or code the inputs can hold. */
import type { EditorDraft } from "./editorDraft";

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

  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const dirty = (Object.keys(draft) as (keyof typeof draft)[]).some(
    (key) => draft[key] !== initial[key],
  );

  const guard = useDiscardGuard(dirty, onCancel);

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
        <div className="flex field flex-col gap-2">
          <DobField
            id={`dob-${entry.id}`}
            value={draft.dob}
            onChange={(value) => set("dob", value)}
            labelClassName="my-2 block"
          />
        </div>
        <div className="flex field flex-col gap-2">
          <PhoneField
            id={`phone-${entry.id}`}
            value={draft.phone}
            onChange={(value) => set("phone", value)}
            labelClassName="my-2 block"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex field flex-col gap-2">
          <CodeSelect
            id={`gender-${entry.id}`}
            label="Gender"
            value={draft.gender}
            codes={GENDERS}
            onChange={(value) => set("gender", value)}
            labelClassName="my-2 block"
          />
        </div>
        <div className="flex field flex-col gap-2">
          <CodeSelect
            id={`caseType-${entry.id}`}
            label="Case type"
            value={draft.caseType}
            codes={CASE_TYPES_BY_LABEL}
            labelFor={(type) => CASE_TYPE_LABEL[type]}
            onChange={(value) => set("caseType", value)}
            labelClassName="my-2 block"
          />
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
        maxLength={MAX_NAME}
        placeholder="Leave blank if nobody has helped yet"
        // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit click, so focus follows intent
        autoFocus
      />

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex field flex-col gap-2">
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
        <div className="flex field flex-col gap-2">
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
        <div className="flex field flex-col gap-2">
          <CodeSelect
            id={`apptType-${entry.id}`}
            label="Appointment type"
            value={draft.appointmentType}
            codes={APPOINTMENT_TYPES}
            onChange={(value) => set("appointmentType", value)}
            labelClassName="my-2 block"
          />
        </div>
        <div className="flex field flex-col gap-2">
          <CodeSelect
            id={`apptOutcome-${entry.id}`}
            label="Appointment outcome"
            value={draft.appointmentOutcome}
            codes={APPOINTMENT_OUTCOMES}
            onChange={(value) => set("appointmentOutcome", value)}
            labelClassName="my-2 block"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex field flex-col gap-2">
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
        <div className="flex field flex-col gap-2">
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
        className="max-w-editor"
        value={draft.adminNote}
        onChange={(event) =>
          set("adminNote", event.target.value.slice(0, MAX_ADMIN_NOTE))
        }
        maxLength={MAX_ADMIN_NOTE}
        rows={3}
        placeholder="Only staff can see this."
      />
      <div className="mt-2 flex max-w-editor flex-wrap items-center justify-end gap-2 card-mode:justify-stretch">
        <span className="mr-auto text-left text-meta text-muted card-mode:mr-0 card-mode:mb-1 card-mode:flex-[1_0_100%]">
          {MAX_ADMIN_NOTE - draft.adminNote.length} characters left
        </span>
        <button
          type="button"
          className="border-border bg-surface text-text card-mode:flex-1"
          onClick={guard.handleCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="card-mode:flex-1"
          onClick={handleSave}
          // The server refuses an empty update, so offering Save on an
          // untouched row would answer a no-op with a failure message.
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <ConfirmDialog
        open={guard.confirming}
        title="Discard your changes?"
        body={`The edits to #${entry.id} have not been saved yet. Closing now throws them away.`}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={guard.discard}
        onCancel={guard.keepEditing}
      />
    </>
  );
}
