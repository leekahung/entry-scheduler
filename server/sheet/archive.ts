import type { Entry } from "../domain/entry.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The month an entry belongs to as "2026-09", in the host's own zone.
 * Set TZ on the host: a clinic evening late in the month is already the next
 * month in UTC, and the row would be filed a month ahead of when it was taken.
 */
export function monthKey(iso: string): string {
  const at = new Date(iso);
  // A row with no usable date belongs to now, which keeps it on the board
  // rather than filing it into a month nobody can name.
  if (Number.isNaN(at.getTime())) return currentMonth();
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  return monthKey(new Date().toISOString());
}

/** The tab a month is kept in, as staff read it: "September 2026". */
export function monthTab(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** The board split into the month tabs its rows belong in. */
export function byMonth(entries: Entry[]): Map<string, Entry[]> {
  const months = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = monthKey(entry.createdAt);
    const rows = months.get(key);
    if (rows) rows.push(entry);
    else months.set(key, [entry]);
  }
  return months;
}

/**
 * Finished entries from a month that has already ended.
 * These are the rows a rollover files away; anything still open stays on the
 * board however old it is, so a booking made for next month is never archived
 * out from under the person waiting on it.
 */
export function finishedBefore(entries: Entry[], month: string): Entry[] {
  return entries.filter(
    (entry) =>
      entry.status === "resolved" && monthKey(entry.createdAt) !== month,
  );
}

/**
 * A month tab's rows updated with what the board now holds.
 * Rows only the tab has are kept: a re-sync must never drop what an earlier
 * rollover already filed there.
 *
 * Keyed by number *and* sign-in time, not the number alone: numbering used to
 * restart at #1 whenever staff emptied the board, so one month can hold two
 * different people as #3, and matching on the number would file one of them
 * over the other.
 */
export function mergeById(archived: Entry[], board: Entry[]): Entry[] {
  const key = (entry: Entry) => `${entry.id}\u0000${entry.createdAt}`;
  const merged = new Map(archived.map((entry) => [key(entry), entry]));
  for (const entry of board) merged.set(key(entry), entry);
  return [...merged.values()].sort(
    (a, b) => a.id - b.id || a.createdAt.localeCompare(b.createdAt),
  );
}
