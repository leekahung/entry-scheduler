import { useEffect, useRef, useState } from "react";

const ACTION = "narrow:w-full";

type Props = {
  open: boolean;
  count: number;
  /** Shown inside the dialog: a failed export is the reason not to clear. */
  downloadError: string;
  onExport: () => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

/**
 * Confirms emptying the board. Offers the export first, because clearing
 * takes the Google Sheet with it and the CSV is the only copy kept.
 */
export default function ClearAllDialog({
  open,
  count,
  downloadError,
  onExport,
  onCancel,
  onConfirm,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [clearing, setClearing] = useState(false);

  // <dialog> needs showModal() to get the focus trap and Esc handling.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal-shell" onClose={onCancel}>
      <h2 className="mx-0 mt-0 mb-2 text-lead">
        Clear all {count} {count === 1 ? "entry" : "entries"}?
      </h2>
      <p className="mx-0 mt-0 mb-5 text-muted">
        This empties the board for a fresh start and numbering begins again at
        #1. It clears the Google Sheet as well and cannot be undone — download
        the spreadsheet first if you need a record of today.
      </p>
      {downloadError && (
        <p className="m-0 text-meta text-danger">{downloadError}</p>
      )}
      {/* Keeps DOM order on mobile so the recommended first step (download)
          stays first and the destructive action stays last. */}
      <div className="flex flex-wrap justify-end gap-2 narrow:flex-col">
        <button
          type="button"
          className={`btn-secondary ${ACTION}`}
          onClick={onExport}
        >
          Download spreadsheet
        </button>
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
          onClick={async () => {
            setClearing(true);
            await onConfirm();
            setClearing(false);
          }}
          disabled={clearing}
        >
          {clearing ? "Clearing…" : "Clear all entries"}
        </button>
      </div>
    </dialog>
  );
}
