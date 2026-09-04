import { Fragment } from "react";
import { CASE_TYPE_LABEL } from "../server/codes";
import {
  missingForLog,
  PRIORITIES,
  PRIORITY_LABEL,
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

// Under card-mode the header row is gone, so each cell grows its own label
// from data-label.
const CELL =
  "px-3 py-[0.7rem] text-left align-middle [overflow-wrap:anywhere] border-b border-row-line card-mode:flex card-mode:items-baseline card-mode:gap-2 card-mode:border-0 card-mode:px-0 card-mode:py-[0.15rem]";

const LABELLED_CELL = `${CELL} card-mode:before:block card-mode:before:flex-[0_0_5.5rem] card-mode:before:text-fine card-mode:before:font-bold card-mode:before:tracking-label card-mode:before:text-muted card-mode:before:uppercase card-mode:before:content-[attr(data-label)]`;

const HEAD_CELL =
  "px-3 pt-[0.7rem] pb-[0.4rem] text-left align-middle text-fine tracking-label text-muted uppercase border-b border-border";

// Fixed widths per action so the column does not reflow when a label changes
// ("Start helping" -> "Mark helped" -> "Reopen").
const ACTION =
  "px-[0.6rem] py-[0.35rem] text-meta pointer-fine:min-h-[2rem] pointer-fine:px-2 pointer-fine:py-1 card-mode:min-w-[6rem] card-mode:flex-[1_1_auto] card-mode:px-3 card-mode:py-[0.6rem] card-mode:text-[0.95rem]";

// Card mode turns every row into a card; the editor row gets the same shell
// so it reads as part of the entry it belongs to.
const ROW =
  "card-mode:mb-3 card-mode:block card-mode:rounded-xl card-mode:border card-mode:border-border card-mode:bg-surface card-mode:px-4 card-mode:py-[0.85rem]";

const TRIAGE_COLOR: Record<Priority, string> = {
  emergency: "text-emergency border-emergency",
  urgent: "text-urgent",
  routine: "",
};

// Two different voices under one name: what the visitor asked for, and what
// staff wrote about it. Labelled so they are never confused.
const NOTE =
  "mt-1 block border-l-2 pl-[0.55rem] text-meta font-normal before:block before:text-fine before:font-bold before:tracking-label before:text-muted before:uppercase card-mode:text-meta";

type Props = {
  rows: AdminEntry[];
  caption: string;
  /** Shown in place of the rows, under the headers, when there are none. */
  empty: string;
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
  empty,
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
    <table
      /* Fixed layout keeps every column the same width whether or not an
         entry has notes, and keeps the active and resolved tables aligned
         with each other since they are separate <table> elements. */
      className="w-full table-fixed border-collapse overflow-hidden rounded-xl border border-border bg-surface card-mode:block card-mode:overflow-visible card-mode:border-none card-mode:bg-transparent"
    >
      <caption className="sr-only">{caption}</caption>
      <thead className="card-mode:hidden">
        <tr>
          {/* Every column is pinned, so the spare width is shared out in
            proportion and Name and Helped by stay the same size as each
            other at any table width. */}
          <th scope="col" className={`${HEAD_CELL} w-[5rem]`}>
            #
          </th>
          <th scope="col" className={`${HEAD_CELL} w-[12rem]`}>
            Name
          </th>
          <th scope="col" className={`${HEAD_CELL} w-[8.5rem]`}>
            Case type
          </th>
          {/* Fits "Emergency" plus the native dropdown arrow. */}
          <th scope="col" className={`${HEAD_CELL} w-[8.25rem]`}>
            Triage
          </th>
          <th scope="col" className={`${HEAD_CELL} w-[8rem]`}>
            Waiting
          </th>
          <th scope="col" className={`${HEAD_CELL} w-[12rem]`}>
            Helped by
          </th>
          {/* Holds all three action buttons on one line at their fixed widths. */}
          <th scope="col" className={`${HEAD_CELL} w-[19.5rem]`}>
            Actions
          </th>
        </tr>
      </thead>
      <tbody className="[&>tr:last-child>td]:border-b-0 card-mode:block">
        {/* The headers stay whatever a tab holds, so an empty one still reads
          as the same table rather than as a different kind of thing. */}
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-5 text-muted">
              {empty}
            </td>
          </tr>
        )}
        {rows.map((entry) => {
          const missing = missingForLog(entry);
          // An appointment is not late until its time comes round, so a
          // booking taken last week is measured from the slot, not from when
          // someone typed it in. Walk-ins have no slot and start on arrival.
          const waitingSince = entry.scheduledFor || entry.createdAt;
          const wait = waitedFor(waitingSince);

          return (
            <Fragment key={entry.id}>
              <tr
                className={`${ROW} ${
                  entry.status === "resolved" ? "text-muted" : ""
                }`}
              >
                {/* data-label supplies the field name once the table collapses
                    into cards on narrow screens, where the header row is gone. */}
                {/* Number and name read as the card's title instead of
                    labelled fields once the table collapses. */}
                <td
                  className={`${CELL} card-mode:pb-0 card-mode:text-[0.95rem] card-mode:font-bold card-mode:text-muted`}
                >
                  #{entry.id}
                  {/* The export exists to track who has been processed, so an
                      unfinished row is worth flagging before it is exported. */}
                  {missing.length > 0 && (
                    <span
                      className="ml-[0.35rem] inline-block size-2 rounded-full bg-new align-[0.1rem]"
                      title={`Still needs ${missing.join(", ")}`}
                    >
                      <span className="sr-only">
                        Still needs {missing.join(", ")}
                      </span>
                    </span>
                  )}
                </td>
                <td
                  className={`${CELL} font-semibold card-mode:block card-mode:pt-0 card-mode:pb-2 card-mode:text-lead`}
                >
                  {entry.name}
                  {entry.note && (
                    <span
                      className={`${NOTE} border-l-border text-text before:content-['Asked_for']`}
                    >
                      {entry.note}
                    </span>
                  )}
                  {entry.adminNote && editingId !== entry.id && (
                    <span
                      className={`${NOTE} border-l-accent text-muted italic before:not-italic before:content-['Staff_note']`}
                    >
                      {entry.adminNote}
                    </span>
                  )}
                </td>
                <td data-label="Case type" className={LABELLED_CELL}>
                  {entry.caseType ? (
                    // The code here, the spelled-out version on hover: the
                    // long labels are written for visitors and run to several
                    // lines in a column this wide.
                    <span
                      className="text-meta"
                      title={CASE_TYPE_LABEL[entry.caseType]}
                    >
                      {entry.caseType}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td data-label="Triage" className={LABELLED_CELL}>
                  {/* A select rather than a badge: retriaging is the whole
                      point of a triage queue, so it should be one click. */}
                  <select
                    className={`pointer-fine:min-h-[2.25rem] px-[0.4rem] py-1 text-meta font-semibold card-mode:max-w-[12rem] ${TRIAGE_COLOR[entry.priority]}`}
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
                <td data-label="Waiting" className={LABELLED_CELL}>
                  <span className="flex flex-col leading-[1.3] whitespace-nowrap">
                    {entry.scheduledFor && (
                      /* Wraps inside the nowrap column, which only needs to
                         keep the date and the time each on their own line. */
                      <span className="text-fine font-bold tracking-label whitespace-normal text-accent uppercase">
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
                              ? "font-bold text-new"
                              : undefined
                          }
                        >
                          {wait.label}
                        </span>
                        <span className="text-meta text-muted">
                          since {formatTime(waitingSince)}
                        </span>
                      </>
                    ) : (
                      // Nobody is waiting here: the entry is either finished
                      // or an appointment whose time has not come round yet.
                      <span className="text-meta text-muted">
                        {entry.status === "resolved" ? "" : "booked "}
                        {formatTime(entry.createdAt)}
                      </span>
                    )}
                  </span>
                </td>
                <td data-label="Helped by" className={LABELLED_CELL}>
                  {entry.helpedBy ? (
                    /* One line, cut with an ellipsis: an address is long
                      enough to wrap and take the row's height with it. The
                      full value stays on the title and in the card layout,
                      which has the width to show it. */
                    <span
                      className="block truncate card-mode:overflow-visible card-mode:whitespace-normal"
                      title={entry.helpedBy}
                    >
                      {entry.helpedBy}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                {/* The flex row lives in a wrapper: a <td> that is itself a
                    flex container stops being a real table cell, which breaks
                    the row separators. */}
                <td className={`${CELL} card-mode:pt-[0.6rem]`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      // Reopening a finished entry is rare; keep it quiet.
                      className={`${ACTION} min-w-[6.75rem] ${
                        entry.status === "resolved"
                          ? "border-border bg-surface text-text"
                          : ""
                      }`}
                      onClick={() => onStatus(entry, NEXT_STATUS[entry.status])}
                    >
                      {STATUS_ACTION[entry.status]}
                    </button>
                    <button
                      type="button"
                      className={`${ACTION} min-w-[5.25rem] border-border bg-surface text-text`}
                      onClick={() => onToggleEdit(entry)}
                      aria-expanded={editingId === entry.id}
                    >
                      {editingId === entry.id ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      className={`${ACTION} min-w-[4.75rem] border-border bg-surface text-danger`}
                      onClick={() => onRemove(entry)}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
              {editingId === entry.id && draft && initialDraft && (
                <tr className={`${ROW} card-mode:-mt-2`}>
                  <td
                    colSpan={7}
                    className="bg-bg px-3 pt-[0.85rem] pb-4 card-mode:block card-mode:px-0 card-mode:py-[0.85rem]"
                  >
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
