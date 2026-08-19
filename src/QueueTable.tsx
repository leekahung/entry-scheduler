import { Fragment } from "react";
import { CASE_TYPE_LABEL } from "../server/codes";
import {
  missingForLog,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type AdminEntry,
  type Priority,
  type Status,
} from "./api";
import EntryEditor, { type EditorDraft } from "./EntryEditor";
import { formatAppointment, formatTime, waitedFor } from "./time";
import type { EntryChanges } from "./useEntries";

const NEXT_STATUS: Record<Status, Status> = {
  new: "pending",
  pending: "resolved",
  resolved: "new",
};

const STATUS_ACTION: Record<Status, string> = {
  new: "Start helping",
  pending: "Mark helped",
  resolved: "Reopen",
};

// Past this a walk-in has been sitting long enough that staff should see it.
const LONG_WAIT_MINUTES = 30;

type Props = {
  rows: AdminEntry[];
  caption: string;
  editingId: number | null;
  /** Held by the page so it survives this row moving between tables. */
  draft: EditorDraft | null;
  initialDraft: EditorDraft | null;
  onDraftChange: (draft: EditorDraft) => void;
  onToggleEdit: (entry: AdminEntry) => void;
  onStatus: (entry: AdminEntry, status: Status) => void;
  onPriority: (entry: AdminEntry, priority: Priority) => void;
  onSave: (entry: AdminEntry, details: EntryChanges) => Promise<boolean>;
  onRemove: (entry: AdminEntry) => void;
};

export default function QueueTable({
  rows,
  caption,
  editingId,
  draft,
  initialDraft,
  onDraftChange,
  onToggleEdit,
  onStatus,
  onPriority,
  onSave,
  onRemove,
}: Props) {
  return (
    <table className="entries">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Name</th>
          <th scope="col">Case type</th>
          <th scope="col">Triage</th>
          <th scope="col">Status</th>
          <th scope="col">Waiting</th>
          <th scope="col">Helped by</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => {
          const missing = missingForLog(entry);
          // An appointment is not late until its time comes round, so a
          // booking taken last week is measured from the slot, not from when
          // someone typed it in. Walk-ins have no slot and start on arrival.
          const waitingSince = entry.scheduledFor || entry.createdAt;
          const wait = waitedFor(waitingSince);

          return (
            <Fragment key={entry.id}>
              <tr className={`row-${entry.status}`}>
                {/* data-label supplies the field name once the table collapses
                    into cards on narrow screens, where the header row is gone. */}
                <td className="cell-id">
                  #{entry.id}
                  {/* The export exists to track who has been processed, so an
                      unfinished row is worth flagging before it is exported. */}
                  {missing.length > 0 && (
                    <span
                      className="incomplete-dot"
                      title={`Still needs ${missing.join(", ")}`}
                    >
                      <span className="visually-hidden">
                        Still needs {missing.join(", ")}
                      </span>
                    </span>
                  )}
                </td>
                <td className="cell-name">
                  {entry.name}
                  {entry.note && (
                    <span className="visitor-note">{entry.note}</span>
                  )}
                  {entry.adminNote && editingId !== entry.id && (
                    <span className="admin-note-preview">
                      {entry.adminNote}
                    </span>
                  )}
                </td>
                <td data-label="Case type">
                  {entry.caseType ? (
                    // The code here, the spelled-out version on hover: the
                    // long labels are written for visitors and run to several
                    // lines in a column this wide.
                    <span
                      className="case-type"
                      title={CASE_TYPE_LABEL[entry.caseType]}
                    >
                      {entry.caseType}
                    </span>
                  ) : (
                    <span className="subtle">—</span>
                  )}
                </td>
                <td data-label="Triage">
                  {/* A select rather than a badge: retriaging is the whole
                      point of a triage queue, so it should be one click. */}
                  <select
                    className={`triage-select triage-${entry.priority}`}
                    value={entry.priority}
                    onChange={(event) =>
                      onPriority(entry, event.target.value as Priority)
                    }
                    aria-label={`Triage level for ${entry.name}`}
                  >
                    {PRIORITIES.map((level) => (
                      <option key={level} value={level}>
                        {PRIORITY_LABEL[level]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Status">
                  <span className={`badge badge-${entry.status}`}>
                    {STATUS_LABEL[entry.status]}
                  </span>
                </td>
                <td data-label="Waiting">
                  <span className="cell-when">
                    {entry.scheduledFor && (
                      <span className="appointment-flag">
                        Appointment {formatAppointment(entry.scheduledFor)}
                      </span>
                    )}
                    {/* How long they have been sitting there is the number
                        staff triage on; the clock time is the reference. */}
                    {entry.status !== "resolved" && entry.due ? (
                      <>
                        <span
                          className={
                            wait.minutes >= LONG_WAIT_MINUTES
                              ? "wait-long"
                              : undefined
                          }
                        >
                          {wait.label}
                        </span>
                        <span className="cell-date">
                          since {formatTime(waitingSince)}
                        </span>
                      </>
                    ) : (
                      // Nobody is waiting here: the entry is either finished
                      // or an appointment whose time has not come round yet.
                      <span className="cell-date">
                        {entry.status === "resolved" ? "" : "booked "}
                        {formatTime(entry.createdAt)}
                      </span>
                    )}
                  </span>
                </td>
                <td data-label="Helped by">
                  {entry.helpedBy || <span className="subtle">—</span>}
                </td>
                {/* The flex row lives in a wrapper: a <td> that is itself a
                    flex container stops being a real table cell, which breaks
                    the row separators. */}
                <td className="cell-actions">
                  <div className="actions-row">
                    <button
                      type="button"
                      // Reopening a finished entry is rare; keep it quiet.
                      className={`action-status${entry.status === "resolved" ? " secondary" : ""}`}
                      onClick={() => onStatus(entry, NEXT_STATUS[entry.status])}
                    >
                      {STATUS_ACTION[entry.status]}
                    </button>
                    <button
                      type="button"
                      className="secondary action-note"
                      onClick={() => onToggleEdit(entry)}
                      aria-expanded={editingId === entry.id}
                    >
                      {editingId === entry.id ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      className="danger action-remove"
                      onClick={() => onRemove(entry)}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
              {editingId === entry.id && draft && initialDraft && (
                <tr className="note-editor-row">
                  <td colSpan={8}>
                    <EntryEditor
                      entry={entry}
                      draft={draft}
                      initial={initialDraft}
                      onChange={onDraftChange}
                      onSave={(details) => onSave(entry, details)}
                      onCancel={() => onToggleEdit(entry)}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
