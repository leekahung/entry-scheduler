/** Addresses are compared lower-cased, so case can never grant or deny twice. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Rejects anything that is not a single plausible address. */
export function isEmailish(email: string): boolean {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email);
}
