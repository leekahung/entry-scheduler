/**
 * A timestamp as staff read it — "2026-09-03 14:15:32" in the host's zone.
 * Seconds are kept, so two entries a moment apart come back in the order they
 * were taken.
 */
export function toStamp(iso: string): string {
  const at = new Date(iso);
  // Returned as is, since the board is rewritten on every change and a
  // hand-typed cell has to survive to be corrected.
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/**
 * That stamp back to ISO. Anything else readable as a date is accepted too,
 * such as an older sheet's ISO; unreadable text is kept as typed.
 */
export function fromStamp(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  // A bare date is UTC midnight to `Date`, which reads back as the day before
  // anywhere west of Greenwich. Typed into the sheet it means a local day.
  const at = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
  );
  return Number.isNaN(at.getTime()) ? value : at.toISOString();
}
