import { isEmailish } from "./email.js";

/**
 * Why a Google sign-in bounced, as the code the callback puts in the URL.
 * Only codes travel, so a crafted link can choose at most an email-shaped
 * address for the console to show, never its own sentence.
 */
export const AUTH_ERRORS = {
  unverified: "Sign-in could not be verified. Please try again.",
  unconfirmed: "Google did not confirm that address.",
  notListed: "That account is not on the staff list for this console.",
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

const FALLBACK = "Sign-in failed. Please try again.";

/**
 * The message for a code from the URL, naming the address where it is one.
 * Anything unrecognised gets the generic message rather than its own text.
 */
export function authErrorMessage(code: string, email = ""): string {
  if (!Object.hasOwn(AUTH_ERRORS, code)) return FALLBACK;
  if (code === "notListed" && isEmailish(email)) {
    return `${email} is not on the staff list for this console.`;
  }
  return AUTH_ERRORS[code as AuthErrorCode];
}
