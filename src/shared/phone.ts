/**
 * US phone numbers as the forms hold them: ten digits, written 503-555-0142.
 * The dashes match the placeholder the fields already showed.
 */

/** The ten digits of a US number, dropping a written-out country code. */
export function usPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

/**
 * Formats as far as the digits go, so the dashes appear while typing.
 *
 * Anything that cannot be a US number — an extension, an overseas number — is
 * left exactly as it was. Reformatting those produced a different, plausible
 * number rather than an obviously wrong one, which is the worse failure: the
 * field is read off and dialled. The input's own maxLength caps the length.
 */
export function formatUsPhone(value: string): string {
  const all = value.replace(/\D/g, "");
  if (all.length > 11 || (all.length === 11 && !all.startsWith("1"))) {
    return value;
  }
  const digits = usPhoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Whether this is a whole US number, rather than half of one. */
export function isCompleteUsPhone(value: string): boolean {
  return usPhoneDigits(value).length === 10;
}
