import { useEffect, useRef } from "react";

/**
 * Drives a <dialog> from whether it should be showing.
 * showModal() rather than the open attribute: the focus trap and Esc come
 * with it and with nothing else.
 */
export function useModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return ref;
}
