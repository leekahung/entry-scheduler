import { useEffect, useState } from "react";
import {
  fetchAuthMode,
  fetchSignedInEmail,
  signOutOfGoogle,
  verifyPasscode,
} from "../shared/api";

const LOCKED_OUT =
  "Too many failed attempts from this device. It is locked for 15 minutes — ask an admin who is already signed in, or wait it out.";
const REJECTED =
  "That passcode was not accepted. The passcode is shared across all staff — check with another admin before retrying.";

/** Which sign-in this deployment uses; null until the server has said. */
export type SignInMode = "google" | "passcode" | null;

/** The message Google sign-in bounced back with, and a cleaned-up URL. */
function takeAuthError(): string {
  const params = new URLSearchParams(window.location.search);
  const message = params.get("authError");
  if (!message) return "";
  // Drop it from the address bar so a reload does not resurrect the error.
  const { pathname, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}${hash}`);
  return message;
}

/**
 * Holds the staff session for one tab: a Google sign-in where the server has
 * it configured, otherwise the shared passcode.
 *
 * Either way the session is re-checked with the server on load rather than
 * trusted from stored state.
 */
export function useAdminSession() {
  const [mode, setMode] = useState<SignInMode>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<"owner" | "staff" | null>(null);
  // Who Google says is at the console, for the console to help as.
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState(takeAuthError);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetchAuthMode()
      .then(async ({ google }) => {
        if (!active) return;
        setMode(google ? "google" : "passcode");
        if (google) {
          // The cookie is the session; nothing is kept on this device.
          const me = await fetchSignedInEmail();
          if (!active || !me) return;
          setEmail(me.email);
          setRole(me.role);
          setName(me.name);
          setSheetUrl(me.sheetUrl);
          setUnlocked(true);
          return;
        }

        const saved = sessionStorage.getItem("adminPasscode");
        if (!saved) return;
        const result = await verifyPasscode(saved);
        if (!active) return;
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
        setSheetUrl(result.sheetUrl);
        setUnlocked(true);
      })
      // Leaving `mode` unknown would show a passcode box a Google-only
      // deployment can never accept, so say what actually happened.
      .catch(() =>
        setError("Could not reach the server. Reload to try again."),
      );

    return () => {
      active = false;
    };
  }, []);

  /** Hands the browser to Google; the callback brings it back signed in. */
  function signInWithGoogle() {
    window.location.href = "/api/auth/google";
  }

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
      setSheetUrl(result.sheetUrl);
      setUnlocked(true);
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  /** `reason` is shown on the sign-in form, for a session the server ended. */
  function signOut(reason = "") {
    if (mode === "google") void signOutOfGoogle();
    sessionStorage.removeItem("adminPasscode");
    setPasscode("");
    setEmail(null);
    setRole(null);
    setName("");
    setUnlocked(false);
    setError(reason);
    setAttemptsLeft(null);
    setSheetUrl(null);
  }

  return {
    mode,
    email,
    role,
    name,
    passcode,
    setPasscode,
    unlocked,
    error,
    attemptsLeft,
    sheetUrl,
    signInWithGoogle,
    unlock,
    signOut,
  };
}
