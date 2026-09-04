import { useState } from "react";

/**
 * Runs one request at a time and reports how it went.
 * `pending` is what disables the buttons that started it; `error` carries the
 * server's own message where there is one, since it usually names the problem
 * better than anything this side could guess.
 *
 * `setError` is here because a form has its own reasons to complain — a
 * malformed address, a duplicate — that never reach the server, and they
 * belong in the same place as the failures that do.
 */
export function useAsyncAction(fallback: string) {
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
      setError(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      // In a finally, so a thrown action cannot leave the buttons disabled.
      setPending(false);
    }
  };

  return { pending, error, setError, run };
}
