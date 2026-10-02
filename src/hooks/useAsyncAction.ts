import { useState } from "react";
import { failureMessage, type ToastFailure } from "../shared/toasts";

/**
 * Runs one request at a time; `pending` disables its buttons and `error` is
 * worded as the console's toasts word a failure.
 * `setError` lets a form report its own checks in the same place.
 */
export function useAsyncAction(failure: string | ToastFailure) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  /** Whether the action landed. Its failure is reported, never thrown. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setError("");
    try {
      await action();
      return true;
    } catch (err) {
      setError(failureMessage(err, failure));
      return false;
    } finally {
      // In a finally, so a thrown action cannot leave the buttons disabled.
      setPending(false);
    }
  };

  return { pending, error, setError, run };
}
