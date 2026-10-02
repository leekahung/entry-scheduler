import { type Entry, isRemoved } from "../domain/entry.js";

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

/**
 * The month a tab holds, or null for a tab that is not one — the live log,
 * the staff list, or anything staff have added themselves.
 */
export function monthFromTab(tab: string): string | null {
  const [, name, year] = /^([A-Za-z]+) (\d{4})$/.exec(tab.trim()) ?? [];
  if (!name || !year) return null;
  const month = MONTH_NAMES.indexOf(name);
  if (month < 0) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * The month tabs a spreadsheet holds, keyed by month.
 * Names are kept as spelled ("January 2026 " included), since a batched read
 * must never name a range that is not a sheet.
 */
export function monthTabs(tabs: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const tab of tabs) {
    const key = monthFromTab(tab);
    // First wins: a second tab for a month is a hand edit, and the app has
    // been writing to the earlier one.
    if (key !== null && !found.has(key)) found.set(key, tab);
  }
  return found;
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
 * Finished or removed entries from an ended month: what a rollover files.
 * Anything still open stays on the board however old it is.
 */
export function finishedBefore(entries: Entry[], month: string): Entry[] {
  return entries.filter(
    (entry) =>
      (entry.status === "resolved" || isRemoved(entry)) &&
      monthKey(entry.createdAt) !== month,
  );
}

/**
 * A month tab's rows updated from the board, keeping rows only the tab has.
 * Keyed by number and sign-in time: numbering restarts when the board empties,
 * so one month can hold two different #3s.
 */
export function mergeById(archived: Entry[], board: Entry[]): Entry[] {
  const key = (entry: Entry) => `${entry.id}\u0000${entry.createdAt}`;
  const merged = new Map(archived.map((entry) => [key(entry), entry]));
  for (const entry of board) merged.set(key(entry), entry);
  return [...merged.values()].sort(
    (a, b) => a.id - b.id || a.createdAt.localeCompare(b.createdAt),
  );
}
