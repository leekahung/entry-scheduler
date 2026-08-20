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
    <dialog
      ref={ref}
      className="m-auto w-[calc(100%-2rem)] max-w-[26rem] rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/45"
      onClose={onCancel}
    >
      <h2 className="mx-0 mt-0 mb-2 text-[1.2rem]">{title}</h2>
      <p className="mx-0 mt-0 mb-5 text-muted">{body}</p>
      {/* Under 480px the buttons stack and the destructive one sits last. */}
      <div className="flex flex-wrap justify-end gap-2 max-[480px]:flex-col-reverse">
        <button
          type="button"
          className="border-border bg-surface text-text max-[480px]:w-full"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="bg-danger text-white max-[480px]:w-full"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
