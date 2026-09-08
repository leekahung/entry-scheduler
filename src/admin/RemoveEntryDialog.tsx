import { useModalDialog } from "../hooks/useModalDialog";
import type { AdminEntry } from "../shared/types";

const ACTION = "narrow:w-full";

type Props = {
  /** The entry awaiting confirmation, or null when the dialog is closed. */
  entry: AdminEntry | null;
  onCancel: () => void;
  onConfirm: (entry: AdminEntry) => void;
};

/** Confirms taking one entry off the board, where it can be put back. */
export default function RemoveEntryDialog({
  entry,
  onCancel,
  onConfirm,
}: Props) {
  const ref = useModalDialog(entry !== null);

  return (
    <dialog ref={ref} className="modal-shell" onClose={onCancel}>
      {entry && (
        <>
          <h2 className="mx-0 mt-0 mb-2 text-lead">Remove #{entry.id}?</h2>
          <p className="mx-0 mt-0 mb-5 text-muted">
            <strong>{entry.name}</strong> comes off the board and out of the
            exports. The entry is kept: it moves to the <strong>Removed</strong>
            tab, where it can be put back.
          </p>
          <div className="flex flex-wrap justify-end gap-2 narrow:flex-col-reverse">
            <button
              type="button"
              className={`btn-secondary ${ACTION}`}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`bg-danger text-white ${ACTION}`}
              onClick={() => onConfirm(entry)}
            >
              Remove entry
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
