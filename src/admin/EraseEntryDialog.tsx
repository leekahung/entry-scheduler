import { useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import type { AdminEntry } from "../shared/types";

const ACTION = "narrow:w-full";

type Props = {
  /** The removed entry awaiting confirmation, or null when closed. */
  entry: AdminEntry | null;
  onCancel: () => void;
  /** The name as it was typed, for the server to check in its turn. */
  onConfirm: (entry: AdminEntry, confirm: string) => void;
};

/**
 * Confirms erasing a removed entry for good — out of its month tab as well as
 * off the board. Owners only, and the name has to be typed: this is the one
 * thing here that nothing undoes.
 */
export default function EraseEntryDialog({
  entry,
  onCancel,
  onConfirm,
}: Props) {
  const ref = useModalDialog(entry !== null);
  // Which entry the box was typed for, so a name entered against one person
  // can never be left standing over the next.
  const [typedFor, setTypedFor] = useState<number | null>(null);
  const [typed, setTyped] = useState("");

  const forThis = entry !== null && typedFor === entry.id;
  const named = forThis && typed.trim() === entry.name.trim();

  // Or the box comes back filled in, and the next time this opens on the same
  // entry the gate is already satisfied by a name nobody typed.
  function close() {
    setTypedFor(null);
    setTyped("");
    onCancel();
  }

  return (
    <dialog ref={ref} className="modal-shell" onClose={close}>
      {entry && (
        <>
          <h2 className="mx-0 mt-0 mb-2 text-lead">
            Erase #{entry.id} for good?
          </h2>
          <p className="mx-0 mt-0 mb-4 text-muted">
            <strong>{entry.name}</strong> is removed from the board and can
            still be put back. Erasing takes the entry out of the month tab as
            well, leaving no record of the visit. Nothing brings it back.
          </p>
          <label className="block" htmlFor="erase-name">
            Type the name to confirm: <strong>{entry.name}</strong>
          </label>
          <input
            id="erase-name"
            className="mt-2 mb-5"
            value={forThis ? typed : ""}
            onChange={(event) => {
              setTypedFor(entry.id);
              setTyped(event.target.value);
            }}
            autoComplete="off"
          />
          <div className="flex flex-wrap justify-end gap-2 narrow:flex-col-reverse">
            <button
              type="button"
              className={`btn-secondary ${ACTION}`}
              onClick={close}
            >
              Keep the record
            </button>
            <button
              type="button"
              className={`bg-danger text-white ${ACTION}`}
              disabled={!named}
              onClick={() => onConfirm(entry, typed)}
            >
              Erase permanently
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
