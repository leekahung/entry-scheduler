import { useState } from "react";
import { MAX_NAME } from "../server/validate";

/**
 * Who the console is helping as.
 * A Google session names itself; a passcode deployment has to ask, because
 * there is no identity behind a shared credential.
 */
export function useHelpedBy(name: string) {
  // Clamped, because the server holds this name to the same length as any
  // other. Deliberately not falling back to the address: signing every entry
  // "kim@clinic.org" reads worse than asking, and the fallback would also hide
  // the box the name could be typed into.
  const signedInAs = (name || "").slice(0, MAX_NAME);
  const [typedAs, setTyped] = useState(
    () => localStorage.getItem("helpedBy") ?? "",
  );

  // Kept on the device, so the name survives a reload of a console nobody
  // signs into.
  const setTypedAs = (value: string) => {
    setTyped(value);
    localStorage.setItem("helpedBy", value);
  };

  return {
    signedInAs,
    typedAs,
    setTypedAs,
    // Signing in is the claim to the work. Nothing on this device can override
    // it, so a console passed between staff cannot credit one for the other's.
    helpedBy: signedInAs || typedAs,
  };
}
