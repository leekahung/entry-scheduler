import { useState } from "react";
import { GENDERS, type Gender } from "../server/codes";
import { MAX_NAME } from "../server/validate";
import type { VisitorIntake } from "./api";
import { CodeSelect, DobField, PhoneField } from "./fields";

// A name field is short enough that a permanent counter is noise; only warn
// once someone is close to the cap.
const NAME_COUNTER_FROM = 60;

type Props = {
  onSubmit: (name: string, intake: VisitorIntake) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string;
};

/**
 * The visitor's own details. Holds the fields itself: the page unmounts this
 * on a successful check-in, which is what clears them.
 */
export default function CheckInForm({
  onSubmit,
  onCancel,
  submitting,
  error,
}: Props) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [phone, setPhone] = useState("");

  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name.trim(), { dob, gender, phone: phone.trim() });
      }}
    >
      <label htmlFor="name">Your name</label>
      <input
        id="name"
        value={name}
        onChange={(event) => setName(event.target.value.slice(0, MAX_NAME))}
        placeholder="e.g. Ada Lovelace"
        maxLength={MAX_NAME}
        autoComplete="name"
        required
        // biome-ignore lint/a11y/noAutofocus: the form opens on an explicit tap, so focus follows intent
        autoFocus
        aria-describedby="name-count"
      />
      {/* Counters carry no aria-live: a per-keystroke countdown is pure noise
          for a screen reader, and aria-describedby already links them to
          their field. */}
      {name.length >= NAME_COUNTER_FROM && (
        <p
          id="name-count"
          className={`mt-[-0.25rem] mr-0 mb-0 ml-0 text-right text-meta ${name.length >= MAX_NAME ? "font-semibold text-new" : "text-muted"}`}
        >
          {name.length >= MAX_NAME
            ? `Character limit reached (${MAX_NAME})`
            : `${MAX_NAME - name.length} characters left`}
        </p>
      )}

      <p className="mt-1 mb-0 text-muted">
        The rest is optional — it saves time later, and only staff see it.
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <div className="flex field flex-col gap-2">
          <DobField id="dob" value={dob} onChange={setDob} />
        </div>
        <div className="flex field flex-col gap-2">
          <PhoneField id="phone" value={phone} onChange={setPhone} />
        </div>
      </div>

      <CodeSelect
        id="gender"
        label="Gender"
        value={gender}
        codes={GENDERS}
        onChange={setGender}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="flex-[1_1_10rem]"
          disabled={submitting || !name.trim()}
        >
          {submitting ? "Checking in…" : "Check in"}
        </button>
        {/* On a shared tablet someone who changes their mind should not have
            to leave their half-typed details on screen. Always offered, so it
            sits in the same place every time. */}
        <button
          type="button"
          className="border-border bg-surface text-text"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
      {error && <p className="m-0 text-meta text-danger">{error}</p>}
    </form>
  );
}
