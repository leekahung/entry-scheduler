import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  body: string;
  /** Wording for the button that goes through with it. */
  confirmLabel: string;
  /** Wording for the way out, when "Cancel" would be ambiguous. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation step for an action that throws work away.
 * Uses <dialog> with showModal() for the focus trap and Esc handling.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal" onClose={onCancel}>
      <h2 className="modal-title">{title}</h2>
      <p className="modal-body">{body}</p>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="danger-solid" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
