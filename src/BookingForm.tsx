import { useState } from "react";
import {
  CASE_TYPE_LABEL,
  CASE_TYPES_BY_LABEL,
  GENDERS,
  type CaseType,
  type Gender,
} from "../server/codes";
import { PRIORITIES, PRIORITY_LABEL, type Priority } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { fromLocalInput, todayLocal } from "./time";
import type { NewBooking } from "./useEntries";

const BLANK = {
  name: "",
  note: "",
  scheduledFor: "",
  priority: "routine" as Priority,
  caseType: "" as CaseType | "",
  phone: "",
  dob: "",
  gender: "" as Gender | "",
};

type Props = {
  onSubmit: (booking: NewBooking) => Promise<boolean>;
  onCancel: () => void;
};

/** Staff-side sign-in: an appointment when given a time, a walk-up when not. */
export default function BookingForm({ onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const set = <K extends keyof typeof BLANK>(
    key: K,
    value: (typeof BLANK)[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const dirty = (Object.keys(BLANK) as (keyof typeof BLANK)[]).some(
    (key) => draft[key] !== BLANK[key],
  );

  const handleCancel = () => (dirty ? setConfirmingCancel(true) : onCancel());

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const saved = await onSubmit({
      ...draft,
      name: draft.name.trim(),
      note: draft.note.trim(),
      phone: draft.phone.trim(),
      scheduledFor: fromLocalInput(draft.scheduledFor),
    });
    setSaving(false);
    if (saved) setDraft(BLANK);
  }

  return (
    <form
      className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
      onSubmit={handleSubmit}
    >
      <h2 className="mx-0 mt-0 mb-1 text-[1.15rem]">Book someone in</h2>
      <p className="mt-1 mb-0 text-muted">
        Leave the time blank for a walk-up. An appointment joins the same line
        at its start time.
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label htmlFor="booking-name">Client name</label>
          <input
            id="booking-name"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            maxLength={80}
            required
          />
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label htmlFor="booking-when">Appointment time</label>
          <input
            id="booking-when"
            type="datetime-local"
            value={draft.scheduledFor}
            onChange={(event) => set("scheduledFor", event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label htmlFor="booking-priority">Triage level</label>
          <select
            id="booking-priority"
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
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label htmlFor="booking-phone">Phone number</label>
          <input
            id="booking-phone"
            type="tel"
            value={draft.phone}
            onChange={(event) => set("phone", event.target.value)}
            maxLength={30}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label htmlFor="booking-dob">Date of birth</label>
          <input
            id="booking-dob"
            type="date"
            value={draft.dob}
            onChange={(event) => set("dob", event.target.value)}
            max={todayLocal()}
          />
        </div>
        <div className="flex flex-[1_1_12rem] flex-col gap-2">
          <label htmlFor="booking-gender">Gender</label>
          <select
            id="booking-gender"
            value={draft.gender}
            onChange={(event) =>
              set("gender", event.target.value as Gender | "")
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
      </div>

      <label htmlFor="booking-caseType">Case type</label>
      <select
        id="booking-caseType"
        value={draft.caseType}
        onChange={(event) =>
          set("caseType", event.target.value as CaseType | "")
        }
      >
        <option value="">—</option>
        {CASE_TYPES_BY_LABEL.map((type) => (
          <option key={type} value={type}>
            {CASE_TYPE_LABEL[type]}
          </option>
        ))}
      </select>

      <label htmlFor="booking-note">Note</label>
      <textarea
        id="booking-note"
        value={draft.note}
        onChange={(event) => set("note", event.target.value)}
        maxLength={280}
        rows={2}
      />

      <div className="mt-2 flex max-w-[44rem] flex-wrap items-center justify-end gap-2 card-mode:justify-stretch">
        <button
          type="button"
          className="border-border bg-surface text-text card-mode:flex-1"
          onClick={handleCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="card-mode:flex-1"
          disabled={saving || !draft.name.trim()}
        >
          {saving ? "Booking…" : "Add to queue"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmingCancel}
        title="Discard this booking?"
        body="Nobody has been added to the queue yet. Closing now throws away what you have typed."
        confirmLabel="Discard booking"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmingCancel(false);
          onCancel();
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
    </form>
  );
}
