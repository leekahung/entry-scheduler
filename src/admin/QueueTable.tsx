import { Fragment } from "react";
import { CASE_TYPE_LABEL } from "../../server/shared/codes";
import {
  STATUS_LABEL,
  STATUSES,
  VISIT_TYPES,
  VISIT_TYPE_LABEL,
  type AdminEntry,
  type Status,
  type VisitType,
} from "../shared/types";
import EntryEditor from "./EntryEditor";
import type { Editing } from "../hooks/useEntryEditor";
import type { EditorDraft } from "./editorDraft";
import { formatAppointment, formatTime, waitedFor } from "../shared/time";
import type { EntryChanges } from "../hooks/useEntries";

// Past this a walk-in has been sitting long enough that staff should see it.
const LONG_WAIT_MINUTES = 30;

// Under card-mode the header row is gone, so each cell grows its own label
// from data-label.
// Shape and spacing, without saying how the cell lays its contents out.
const CELL_BASE =
  "px-3 py-3 text-left align-middle [overflow-wrap:anywhere] border-b border-row-line card-mode:border-0 card-mode:px-0 card-mode:py-0.5";

// As a card, most cells put their label and value on one line.
const CELL = `${CELL_BASE} card-mode:flex card-mode:items-baseline card-mode:gap-2`;

// The name is the card's heading, and its notes belong under it rather than
// beside it: sharing the row, a two-word name is squeezed into a column narrow
// enough to break it across lines.
const NAME_CELL = `${CELL_BASE} card-mode:block`;

const LABELLED_CELL = `${CELL} card-mode:before:block card-mode:before:flex-[0_0_5.5rem] card-mode:before:text-fine card-mode:before:font-bold card-mode:before:tracking-label card-mode:before:text-muted card-mode:before:uppercase card-mode:before:content-[attr(data-label)]`;

const HEAD_CELL =
  "px-3 pt-3 pb-1.5 text-left align-middle text-fine tracking-label text-muted uppercase border-b border-border";

// Fixed widths per action so the column does not reflow when a label changes
// ("Edit" -> "Close").
const ACTION =
  "px-2.5 py-1.5 text-meta pointer-fine:min-h-8 pointer-fine:px-2 pointer-fine:py-1 card-mode:min-w-[6rem] card-mode:flex-[1_1_auto] card-mode:px-3 card-mode:py-2.5 card-mode:text-[0.95rem]";

// Card mode turns every row into a card; the editor row gets the same shell
// so it reads as part of the entry it belongs to.
//
// The card is a grid, not a stack: one field per line left most of a card's
// width empty beside short values like a code or a select. `auto-fit` takes
// as many columns as the card can hold, so a phone still gets one and a
// tablet two or three. The `min()` keeps the track from ever being wider than
// the card itself, which would push the content sideways on a narrow screen.
const ROW =
  "card-mode:mb-3 card-mode:grid card-mode:grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] card-mode:items-start card-mode:gap-x-5 card-mode:rounded-xl card-mode:border card-mode:border-border card-mode:bg-surface card-mode:px-4 card-mode:py-3.5";

// The card's title and its buttons take the full width; the labelled fields
// in between are what share the columns.
const FULL_WIDTH = "card-mode:[grid-column:1/-1]";

// Two different voices under one name: what the visitor asked for, and what
// staff wrote about it. Labelled so they are never confused.
const NOTE =
  "mt-1 block border-l-2 pl-2 text-meta font-normal before:block before:text-fine before:font-bold before:tracking-label before:text-muted before:uppercase card-mode:text-meta";

type Props = {
  rows: AdminEntry[];
  caption: string;
  /** Shown in place of the rows, under the headers, when there are none. */
  empty: string;
  /** Held by the page so it survives this row moving between tables. */
  editing: Editing | null;
  onDraftChange: (draft: EditorDraft) => void;
  onToggleEdit: (entry: AdminEntry) => void;
  onStatus: (entry: AdminEntry, status: Status) => void;
  onVisitType: (entry: AdminEntry, visitType: VisitType) => void;
  onSave: (entry: AdminEntry, details: EntryChanges) => Promise<boolean>;
  onRemove: (entry: AdminEntry) => void;
  onRestore: (entry: AdminEntry) => void;
  onErase: (entry: AdminEntry) => void;
  /** Erasing a removed row for good is an owner's. */
  owner: boolean;
};

export default function QueueTable({
  rows,
  caption,
  empty,
  editing,
  onDraftChange,
  onToggleEdit,
  onStatus,
  onVisitType,
  onSave,
  onRemove,
  onRestore,
  onErase,
  owner,
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
          {/* Fits the longer of the two labels plus the dropdown arrow. */}
          <th scope="col" className={`${HEAD_CELL} w-[11.5rem]`}>
            Visit type
          </th>
          <th scope="col" className={`${HEAD_CELL} w-[8rem]`}>
            Waiting
          </th>
          <th scope="col" className={`${HEAD_CELL} w-[12rem]`}>
            Helped by
          </th>
          {/* The status select and the two buttons on one line. The select is
            held to the width of "Being helped" so the buttons after it line up
            row to row; the other two states need less and get it anyway. */}
          <th scope="col" className={`${HEAD_CELL} w-[20rem]`}>
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
                  className={`${CELL} ${FULL_WIDTH} card-mode:pb-0 card-mode:text-[0.95rem] card-mode:font-bold card-mode:text-muted`}
                >
                  #{entry.id}
                </td>
                <td
                  className={`${NAME_CELL} ${FULL_WIDTH} font-semibold card-mode:pt-0 card-mode:pb-2 card-mode:text-lead`}
                >
                  {entry.name}
                  {entry.note && (
                    <span
                      className={`${NOTE} border-l-border text-text before:content-['Asked_for']`}
                    >
                      {entry.note}
                    </span>
                  )}
                  {entry.adminNote && editing?.id !== entry.id && (
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
                <td data-label="Visit type" className={LABELLED_CELL}>
                  {/* A select rather than a badge: someone who rang ahead can
                      turn up in person, so it should be one click to change. */}
                  <select
                    className="pointer-fine:min-h-9 px-1.5 py-1 text-meta font-semibold card-mode:max-w-[12rem]"
                    value={entry.visitType}
                    onChange={(event) =>
                      onVisitType(entry, event.target.value as VisitType)
                    }
                    aria-label={`Visit type for ${entry.name}`}
                    disabled={Boolean(entry.deletedAt)}
                  >
                    {VISIT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {VISIT_TYPE_LABEL[type]}
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
                        staff work from; the clock time is the reference. */}
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
                <td className={`${CELL} ${FULL_WIDTH} card-mode:pt-2.5`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.deletedAt ? (
                      <>
                        {/* A removed row is not part of the queue, so none of
                          the queue's actions apply to it. Putting it back is
                          what it is here for. */}
                        <button
                          type="button"
                          className={`${ACTION} min-w-[6.75rem]`}
                          onClick={() => onRestore(entry)}
                        >
                          Put back
                        </button>
                        {owner && (
                          <button
                            type="button"
                            className={`${ACTION} min-w-[5.25rem] border-border bg-surface text-danger`}
                            onClick={() => onErase(entry)}
                          >
                            Erase
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {/* A select rather than a button that walks the
                          states in a circle: staff move a row wherever it
                          belongs in one place, and correcting a misclick is
                          the same control as making it rather than a second
                          one sitting beside the first.

                          w-auto because the base stylesheet gives every select
                          width:100%, which in this flex row would take the
                          whole line and push the two buttons off it. */}
                        <select
                          className="w-auto flex-none min-w-[7.5rem] pointer-fine:min-h-9 px-1.5 py-1 text-meta font-semibold"
                          value={entry.status}
                          onChange={(event) =>
                            onStatus(entry, event.target.value as Status)
                          }
                          aria-label={`Status for ${entry.name}`}
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {STATUS_LABEL[status]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`${ACTION} min-w-[5.25rem] border-border bg-surface text-text`}
                          onClick={() => onToggleEdit(entry)}
                          aria-expanded={editing?.id === entry.id}
                        >
                          {editing?.id === entry.id ? "Close" : "Edit"}
                        </button>
                        <button
                          type="button"
                          className={`${ACTION} min-w-[4.75rem] border-border bg-surface text-danger`}
                          onClick={() => onRemove(entry)}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {editing && editing.id === entry.id && !entry.deletedAt && (
                <tr className={`${ROW} card-mode:-mt-2`}>
                  <td
                    colSpan={7}
                    className={`bg-bg px-3 pt-3.5 pb-4 ${FULL_WIDTH} card-mode:block card-mode:px-0 card-mode:py-3.5`}
                  >
                    <EntryEditor
                      entry={entry}
                      draft={editing.draft}
                      initial={editing.initial}
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
