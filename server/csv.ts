import type { Entry } from "./db.js";

/** The SIGN IN LOG SPREADSHEET header row, in its own order. */
const COLUMNS: readonly [string, (entry: Entry) => string | number][] = [
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

function escapeCell(value: string | number): string {
  const text = String(value);
  // Prefix formula-leading characters so spreadsheets treat them as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Renders entries as RFC 4180 CSV with a header row. */
export function toCsv(entries: Entry[]): string {
  const rows = [
    COLUMNS.map(([header]) => header).join(","),
    ...entries.map((entry) =>
      COLUMNS.map(([, read]) => escapeCell(read(entry))).join(","),
    ),
  ];
  return `${rows.join("\r\n")}\r\n`;
}
