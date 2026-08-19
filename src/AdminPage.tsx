import { useEffect, useRef, useState } from "react";
import {
  downloadCsv,
  missingForLog,
  PRIORITIES,
  PRIORITY_LABEL,
  type AdminEntry,
  type Priority,
  type Status,
} from "./api";
import BookingForm from "./BookingForm";
import { seedDraft, type EditorDraft } from "./EntryEditor";
import QueueTable from "./QueueTable";
import { minutesAgo } from "./time";
import type { EntryChanges } from "./useEntries";
import { useAdminSession } from "./useAdminSession";
import { useEntries } from "./useEntries";

// One or two failures is someone fumbling their own passcode; a handful in a
// quarter hour is worth staff looking up.
const ALERT_FROM = 3;
// Only warn about the lockout once it's close enough to matter.
const REMAINING_WARN_FROM = 5;

/** Staff console: work the queue, book people in, export the full sheet. */
export default function AdminPage() {
  const session = useAdminSession();
  const { passcode, unlocked } = session;
  const queue = useEntries(passcode, unlocked);

  const [helpedBy, setHelpedBy] = useState(
    () => localStorage.getItem("helpedBy") ?? "",
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  // The draft lives up here, not in the editor: an entry can move between the
  // three tables mid-edit (an appointment coming due, another admin changing
  // its status), which unmounts the editor and would take the draft with it.
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [initialDraft, setInitialDraft] = useState<EditorDraft | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [showResolved, setShowResolved] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<AdminEntry | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [query, setQuery] = useState("");
  const [triage, setTriage] = useState<Priority | "">("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);

  // <dialog> needs showModal() to get the focus trap and Esc handling.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pendingDelete && !dialog.open) dialog.showModal();
    if (!pendingDelete && dialog.open) dialog.close();
  }, [pendingDelete]);

  useEffect(() => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    if (confirmingClear && !dialog.open) dialog.showModal();
    if (!confirmingClear && dialog.open) dialog.close();
  }, [confirmingClear]);

  // Through a ref so the effect fires on a new rejection, not on every render.
  const signOutRef = useRef(handleSignOut);
  signOutRef.current = handleSignOut;

  // The server has stopped accepting this session; drop it rather than poll on.
  // Anything else it rejects (a 429 from the admin rate limit) also stops the
  // poll, but is recoverable, so that surfaces as a banner instead.
  useEffect(() => {
    if (queue.rejected?.status === 401) {
      signOutRef.current(queue.rejected.message);
    }
  }, [queue.rejected]);

  function closeEditor() {
    setEditingId(null);
    setDraft(null);
    setInitialDraft(null);
  }

  function handleSignOut(reason?: string) {
    session.signOut(reason);
    closeEditor();
    setShowBooking(false);
  }

  const exportSheet = () => {
    // Cleared first, or a failure from an earlier attempt sits on screen
    // looking like it belongs to this one.
    setDownloadError("");
    return downloadCsv(passcode).catch(() =>
      setDownloadError("Could not download the spreadsheet."),
    );
  };

  if (!unlocked) {
    return (
      <main className="page page-narrow">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            session.unlock();
          }}
        >
          <h1>Staff sign-in</h1>
          <p className="subtle">
            Enter the staff passcode to manage the help queue.
          </p>
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            type="password"
            value={passcode}
            onChange={(event) => session.setPasscode(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit">Unlock</button>
          {session.error && <p className="error">{session.error}</p>}
          {session.attemptsLeft !== null &&
            session.attemptsLeft <= REMAINING_WARN_FROM && (
              <p className="error-detail">
                {session.attemptsLeft === 0
                  ? "No attempts left — this device is now locked for 15 minutes."
                  : `${session.attemptsLeft} ${session.attemptsLeft === 1 ? "attempt" : "attempts"} left before this device is locked out for 15 minutes.`}
              </p>
            )}
        </form>
        <p className="signin-back">
          Here to get help instead? <a href="#/">Check in</a>
        </p>
      </main>
    );
  }

  const { entries, alerts, offline, loaded } = queue;

  // Matched against the name and the number, since staff have either one to
  // hand: a name called across the room, or a number on a slip of paper.
  const needle = query.trim().toLowerCase();
  const visible = entries.filter((entry) => {
    if (triage && entry.priority !== triage) return false;
    if (incompleteOnly && missingForLog(entry).length === 0) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      String(entry.id).includes(needle.replace("#", ""))
    );
  });
  const filtering = Boolean(needle || triage || incompleteOnly);

  // Three lists, one line. `due` comes from the server, which also decides the
  // order, so the split can never disagree with the queue it is describing.
  const inRoom = visible.filter((e) => e.status !== "resolved" && e.due);
  const upcoming = visible.filter((e) => e.status !== "resolved" && !e.due);
  const resolved = visible.filter((e) => e.status === "resolved");
  const incompleteCount = entries.filter(
    (e) => missingForLog(e).length > 0,
  ).length;

  // Counted off the full queue, not the filtered view: this line is the state
  // of the room, and a filter should never make people appear to leave it.
  const allInRoom = entries.filter((e) => e.status !== "resolved" && e.due);
  const beingHelped = allInRoom.filter((e) => e.status === "pending").length;

  const toggleEdit = (entry: AdminEntry) => {
    if (editingId === entry.id) {
      closeEditor();
      return;
    }
    const seeded = seedDraft(entry);
    setEditingId(entry.id);
    setDraft(seeded);
    setInitialDraft(seeded);
  };

  const tableProps = {
    editingId,
    draft,
    initialDraft,
    onDraftChange: setDraft,
    onToggleEdit: toggleEdit,
    onStatus: (entry: AdminEntry, status: Status) =>
      queue.setStatus(entry, status, helpedBy.trim()),
    onPriority: (entry: AdminEntry, priority: Priority) =>
      queue.setPriority(entry, priority),
    onSave: async (entry: AdminEntry, details: EntryChanges) => {
      const saved = await queue.saveDetails(entry, details);
      if (saved) closeEditor();
      return saved;
    },
    onRemove: setPendingDelete,
  };

  return (
    <main className="page page-wide">
      <header className="page-head admin-head">
        <div>
          <h1>Queue admin</h1>
          <p className="subtle">
            {allInRoom.length - beingHelped} waiting · {beingHelped} being
            helped ·{" "}
            {entries.filter((e) => e.status !== "resolved" && !e.due).length}{" "}
            scheduled later ·{" "}
            {entries.filter((e) => e.status === "resolved").length} done
          </p>
        </div>
        <div className="head-actions">
          <button
            type="button"
            onClick={() => setShowBooking((shown) => !shown)}
            aria-expanded={showBooking}
          >
            {showBooking ? "Close" : "Book someone in"}
          </button>
          <button type="button" className="secondary" onClick={exportSheet}>
            Download spreadsheet
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => handleSignOut()}
          >
            Sign out
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => setConfirmingClear(true)}
            disabled={entries.length === 0}
          >
            Clear all
          </button>
        </div>
      </header>

      {showBooking && (
        <BookingForm
          onSubmit={async (booking) => {
            const saved = await queue.book(booking);
            if (saved) setShowBooking(false);
            return saved;
          }}
          onCancel={() => setShowBooking(false)}
        />
      )}

      <div className="identity-bar">
        <label htmlFor="helpedBy">Helping as</label>
        <input
          id="helpedBy"
          value={helpedBy}
          onChange={(event) => {
            setHelpedBy(event.target.value);
            localStorage.setItem("helpedBy", event.target.value);
          }}
          placeholder="Your name, e.g. Kim"
          aria-describedby="helpedBy-hint"
        />
        <p id="helpedBy-hint" className="identity-hint">
          {helpedBy.trim()
            ? `Entries you work on will be credited to ${helpedBy.trim()}.`
            : "Add your name so the queue shows who helped each person."}
        </p>
      </div>

      {offline && (
        <p className="offline-banner" role="status">
          Can&rsquo;t reach the server — this list may be out of date.
        </p>
      )}

      {queue.rejected && queue.rejected.status !== 401 && (
        <p className="offline-banner" role="status">
          {queue.rejected.message} The list has stopped refreshing.{" "}
          <button type="button" className="link-button" onClick={queue.resume}>
            Try again
          </button>
        </p>
      )}

      {/* Hidden while the clear-all dialog is up, which shows its own copy on
          top of the backdrop. */}
      {(queue.actionError || downloadError) && !confirmingClear && (
        <p className="error">{queue.actionError || downloadError}</p>
      )}

      {alerts && alerts.failedAttempts >= ALERT_FROM && (
        <p className="alert-banner" role="status">
          <strong>{alerts.failedAttempts} failed sign-in attempts</strong> in
          the last {alerts.windowMinutes} minutes
          {alerts.lastAttemptAt &&
            `, most recent ${minutesAgo(alerts.lastAttemptAt)}`}
          . Check with the other admins — if it was none of them, rotate the
          passcode.
        </p>
      )}

      <div className="filter-bar">
        <label className="visually-hidden" htmlFor="entry-search">
          Search by name or number
        </label>
        <input
          id="entry-search"
          type="search"
          className="filter-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or #number"
        />
        <label className="visually-hidden" htmlFor="triage-filter">
          Triage level
        </label>
        <select
          id="triage-filter"
          className="filter-select"
          value={triage}
          onChange={(event) => setTriage(event.target.value as Priority | "")}
        >
          <option value="">Any triage level</option>
          {PRIORITIES.map((level) => (
            <option key={level} value={level}>
              {PRIORITY_LABEL[level]}
            </option>
          ))}
        </select>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(event) => setIncompleteOnly(event.target.checked)}
          />
          Needs details ({incompleteCount})
        </label>
        {filtering && (
          <button
            type="button"
            className="secondary filter-clear"
            onClick={() => {
              setQuery("");
              setTriage("");
              setIncompleteOnly(false);
            }}
          >
            Clear filters
          </button>
        )}
        {filtering && (
          <p className="filter-count" role="status">
            {visible.length} of {entries.length} shown
          </p>
        )}
      </div>

      <section aria-labelledby="active-heading">
        <h2 id="active-heading" className="section-heading">
          In the queue now ({inRoom.length})
        </h2>
        {!loaded ? (
          <p className="empty-note">Loading entries…</p>
        ) : inRoom.length === 0 ? (
          <p className="empty-note">
            {filtering
              ? "No entries match these filters."
              : entries.length === 0
                ? "No entries yet."
                : "Nobody is waiting — everyone has been helped."}
          </p>
        ) : (
          <QueueTable
            rows={inRoom}
            caption="Walk-ins and appointments that are due, in queue order"
            {...tableProps}
          />
        )}
      </section>

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="section-heading">
            Scheduled later ({upcoming.length})
          </h2>
          <p className="subtle section-note">
            Not in the line yet. Each joins automatically when its time comes.
          </p>
          <QueueTable
            rows={upcoming}
            caption="Appointments that are not due yet"
            {...tableProps}
          />
        </section>
      )}

      {resolved.length > 0 && (
        <section aria-labelledby="resolved-heading">
          <div className="section-head">
            <h2 id="resolved-heading" className="section-heading">
              Done ({resolved.length})
            </h2>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowResolved((shown) => !shown)}
              aria-expanded={showResolved}
            >
              {showResolved ? "Hide" : "Show"}
            </button>
          </div>
          {showResolved && (
            <QueueTable
              rows={resolved}
              caption="Entries already helped"
              {...tableProps}
            />
          )}
        </section>
      )}

      <dialog
        ref={clearDialogRef}
        className="modal"
        onClose={() => setConfirmingClear(false)}
      >
        <h2 className="modal-title">
          Clear all {entries.length}{" "}
          {entries.length === 1 ? "entry" : "entries"}?
        </h2>
        <p className="modal-body">
          This empties the board for a fresh start and numbering begins again at
          #1. It cannot be undone — download the spreadsheet first if you need a
          record of today.
        </p>
        {downloadError && <p className="error">{downloadError}</p>}
        {/* Keeps DOM order on mobile so the recommended first step (download)
            stays first and the destructive action stays last. */}
        <div className="modal-actions modal-actions-ordered">
          <button type="button" className="secondary" onClick={exportSheet}>
            Download spreadsheet
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setConfirmingClear(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger-solid"
            onClick={async () => {
              setClearing(true);
              await queue.clearAll();
              setClearing(false);
              setConfirmingClear(false);
              closeEditor();
            }}
            disabled={clearing}
          >
            {clearing ? "Clearing…" : "Clear all entries"}
          </button>
        </div>
      </dialog>

      <dialog
        ref={dialogRef}
        className="modal"
        onClose={() => setPendingDelete(null)}
      >
        {pendingDelete && (
          <>
            <h2 className="modal-title">Remove #{pendingDelete.id}?</h2>
            <p className="modal-body">
              <strong>{pendingDelete.name}</strong> will be removed from the
              queue and from the CSV export. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-solid"
                onClick={() => {
                  const entry = pendingDelete;
                  setPendingDelete(null);
                  queue.remove(entry);
                }}
              >
                Remove entry
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
