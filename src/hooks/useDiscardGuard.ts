import { useState } from "react";

/**
 * Asks before a close that would throw unsaved work away.
 * A form nobody has touched still closes on the first click.
 */
export function useDiscardGuard(dirty: boolean, onCancel: () => void) {
  const [confirming, setConfirming] = useState(false);

  return {
    confirming,
    /** What the close button runs. */
    handleCancel: () => (dirty ? setConfirming(true) : onCancel()),
    keepEditing: () => setConfirming(false),
    discard: () => {
      setConfirming(false);
      onCancel();
    },
  };
}
