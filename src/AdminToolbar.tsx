import type { AdminEntry } from "./api";

type Props = {
  entries: AdminEntry[];
  /** Everyone actually in the line, and how many of them are being helped. */
  inRoom: number;
  beingHelped: number;
  email: string | null;
  sheetUrl: string | null;
  showBooking: boolean;
  onToggleBooking: () => void;
  onExport: () => void;
  onSignOut: () => void;
  onClearAll: () => void;
};

/** Title, the state of the room in one line, and the console's actions. */
export default function AdminToolbar({
  entries,
  inRoom,
  beingHelped,
  email,
  sheetUrl,
  showBooking,
  onToggleBooking,
  onExport,
  onSignOut,
  onClearAll,
}: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="m-0 text-title">Queue admin</h1>
        <p className="mt-1 mb-0 text-muted">
          {inRoom - beingHelped} waiting · {beingHelped} being helped ·{" "}
          {entries.filter((e) => e.status !== "resolved" && !e.due).length}{" "}
          scheduled later ·{" "}
          {entries.filter((e) => e.status === "resolved").length} done
        </p>
        {email && (
          <p className="mt-1 mb-0 text-meta text-muted">Signed in as {email}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleBooking}
          aria-expanded={showBooking}
        >
          {showBooking ? "Close" : "Book someone in"}
        </button>
        {sheetUrl && (
          <a
            data-button
            className="btn-secondary"
            href={sheetUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open spreadsheet
          </a>
        )}
        {/* The same export the clear-all dialog offers, up here so a record
          can be taken without opening Google Sheets — and the only way to
          get one when Sheets is not configured. */}
        <button type="button" className="btn-secondary" onClick={onExport}>
          Download spreadsheet
        </button>
        <button type="button" className="btn-secondary" onClick={onSignOut}>
          Sign out
        </button>
        {/* "Clear all" wipes the board; keep it off the elbow of "Sign out". */}
        <button
          type="button"
          className="ml-2 border-border bg-surface text-danger"
          onClick={onClearAll}
          disabled={entries.length === 0}
        >
          Clear all
        </button>
      </div>
    </header>
  );
}
