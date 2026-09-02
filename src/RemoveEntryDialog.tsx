import { useEffect, useRef } from "react";
import type { AdminEntry } from "./api";

const ACTION = "narrow:w-full";

type Props = {
  /** The entry awaiting confirmation, or null when the dialog is closed. */
  entry: AdminEntry | null;
  onCancel: () => void;
  onConfirm: (entry: AdminEntry) => void;
};

/** Confirms taking one entry off the board and out of the spreadsheet. */
export default function RemoveEntryDialog({
  entry,
  onCancel,
  onConfirm,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  // <dialog> needs showModal() to get the focus trap and Esc handling.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (entry && !dialog.open) dialog.showModal();
    if (!entry && dialog.open) dialog.close();
  }, [entry]);

  return (
    <dialog ref={ref} className="modal-shell" onClose={onCancel}>
      {entry && (
        <>
          <h2 className="mx-0 mt-0 mb-2 text-lead">Remove #{entry.id}?</h2>
          <p className="mx-0 mt-0 mb-5 text-muted">
            <strong>{entry.name}</strong> will be removed from the queue and
            deleted from the Google Sheet. This cannot be undone.
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
