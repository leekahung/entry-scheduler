import type { AdminEntry } from "../shared/types";
import { DownloadIcon, ExternalIcon, SignOutIcon } from "./icons";

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
  onExportWorkbook: () => void;
  /** Whether this session may take the whole record, not just the board. */
  owner: boolean;
  onSignOut: () => void;
  /** Whether this session may change who has access at all. */
  manageStaff: boolean;
  showStaff: boolean;
  onToggleStaff: () => void;
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
  onExportWorkbook,
  owner,
  onSignOut,
  manageStaff,
  showStaff,
  onToggleStaff,
}: Props) {
  return (
    <header className="flex flex-col gap-3">
      {/* Two rows: the account and the record sit top right, out of the way of
        the work; what staff reach for while working the queue sits below. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-title">Queue admin</h1>
          <p className="mt-1 mb-0 text-muted">
            {inRoom - beingHelped} waiting · {beingHelped} being helped ·{" "}
            {entries.filter((e) => e.status !== "resolved" && !e.due).length}{" "}
            scheduled later ·{" "}
            {entries.filter((e) => e.status === "resolved").length} done
          </p>
          {email && (
            <p className="mt-1 mb-0 text-meta text-muted">
              Signed in as {email}
            </p>
          )}
        </div>
        {/* Right of the title where there is room; on a phone the two rows
          stack and a right edge to line up against no longer exists. */}
        <div className="flex flex-wrap justify-end gap-2 narrow:justify-start">
          {sheetUrl && (
            <a
              data-button
              className="btn-secondary gap-2"
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalIcon />
              Open spreadsheet
            </a>
          )}
          {/* Up here so a record can be taken without opening Google Sheets —
            and the only way to get one when Sheets is not configured. Both
            are Excel, so neither says so: the difference that matters is
            whether the months already filed away are in it, and naming the
            shared format only cost the room to stay beside the title. */}
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            onClick={onExport}
          >
            <DownloadIcon />
            Download current list
          </button>
          {/* The record to keep, rather than the list to paste: every month
            the spreadsheet holds, each in its own tab. Owners only, and the
            server enforces it — this holds far more than the board does. */}
          {owner && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2"
              onClick={onExportWorkbook}
            >
              <DownloadIcon />
              Download all months
            </button>
          )}
          {/* The same red-on-surface as Remove: not destructive to anyone
            else's data, but it ends the session and should read that way. */}
          <button
            type="button"
            className="inline-flex items-center gap-2 border-border bg-surface text-danger"
            onClick={onSignOut}
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Held to the width of the longer label so the button does not
          shrink to "Close" and drag whatever sits beside it sideways. */}
        <button
          type="button"
          className="min-w-[10rem]"
          onClick={onToggleBooking}
          aria-expanded={showBooking}
        >
          {showBooking ? "Close" : "Book someone in"}
        </button>
        {manageStaff && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onToggleStaff}
            aria-expanded={showStaff}
          >
            {showStaff ? "Close staff access" : "Staff access"}
          </button>
        )}
      </div>
    </header>
  );
}
