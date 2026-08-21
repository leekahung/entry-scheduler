import type { Entry } from "./entry.js";

/**
 * The SIGN IN LOG SPREADSHEET header row, in its own order.
 * The spreadsheet carries these columns first, then the machine fields in
 * `server/store.ts`, so the human log and the CSV can never drift.
 */
export const LOG_COLUMNS: readonly [
  string,
  (entry: Entry) => string | number,
][] = [
  ["Date", (e) => e.createdAt.slice(0, 10)],
  ["Client Name", (e) => e.name],
  ["DOB", (e) => e.dob],
  ["Gender", (e) => e.gender],
  ["Phone #", (e) => e.phone],
  ["Case Type", (e) => e.caseType],
  ["Appointment Type", (e) => e.appointmentType],
  ["Appointment Outcome", (e) => e.appointmentOutcome],
  // The log has one Notes column; keep both notes rather than dropping either.
  ["Notes", (e) => [e.note, e.adminNote].filter(Boolean).join("\n")],
  ["Legal Outcome", (e) => e.legalOutcome],
  ["Time (0.25 increments)", (e) => (e.timeSpent ? e.timeSpent : "")],
];

/** The log as a header row plus one row per entry. */
export function toRows(entries: Entry[]): (string | number)[][] {
  return [
    LOG_COLUMNS.map(([header]) => header),
    ...entries.map((entry) => LOG_COLUMNS.map(([, read]) => read(entry))),
  ];
}

function escapeCell(value: string | number): string {
  const text = String(value);
  // Prefix formula-leading characters so spreadsheets treat them as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Renders entries as RFC 4180 CSV with a header row. */
export function toCsv(entries: Entry[]): string {
  const [header, ...data] = toRows(entries);
  const rows = [
    header.join(","),
    ...data.map((row) => row.map(escapeCell).join(",")),
  ];
  return `${rows.join("\r\n")}\r\n`;
}
