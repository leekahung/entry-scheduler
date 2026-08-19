import { useEffect, useState } from "react";
import { verifyPasscode } from "./api";

const LOCKED_OUT =
  "Too many failed attempts from this device. It is locked for 15 minutes — ask an admin who is already signed in, or wait it out.";
const REJECTED =
  "That passcode was not accepted. The passcode is shared across all staff — check with another admin before retrying.";

/**
 * Holds the shared-passcode session for one tab, including restoring it
 * across reloads by re-verifying rather than trusting stored state.
 */
export function useAdminSession() {
  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("adminPasscode");
    if (!saved) return;

    verifyPasscode(saved)
      .then((result) => {
        // A lockout is a verdict on the address, not on the passcode, so it
        // must not throw away a session that is probably still good — but say
        // so, or the sign-in form looks broken for no visible reason.
        if (result.lockedOut) {
          setError(LOCKED_OUT);
          return;
        }
        if (!result.accepted) {
          sessionStorage.removeItem("adminPasscode");
          return;
        }
        // Never clobber a passcode already being typed while this was in
        // flight; the stored one is only a fallback for an untouched field.
        setPasscode((current) => current || saved);
        setUnlocked(true);
      })
      // An unreachable server says nothing about the passcode, so keep it.
      .catch(() => {});
  }, []);

  async function unlock() {
    setError("");
    setAttemptsLeft(null);
    try {
      const result = await verifyPasscode(passcode);
      if (result.lockedOut) {
        setError(LOCKED_OUT);
        return;
      }
      if (!result.accepted) {
        setError(REJECTED);
        setAttemptsLeft(result.remaining);
        return;
      }
      sessionStorage.setItem("adminPasscode", passcode);
      setUnlocked(true);
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  /** `reason` is shown on the sign-in form, for a session the server ended. */
  function signOut(reason = "") {
    sessionStorage.removeItem("adminPasscode");
    setPasscode("");
    setUnlocked(false);
    setError(reason);
    setAttemptsLeft(null);
  }

  return {
    passcode,
    setPasscode,
    unlocked,
    error,
    attemptsLeft,
    unlock,
    signOut,
  };
}
