import { useEffect, useRef, useState } from "react";
import {
  downloadCsv,
  syncSheet,
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
import { minutesAgo, unclosedMonth } from "./time";
import type { EntryChanges } from "./useEntries";
import { useAdminSession } from "./useAdminSession";
import { useEntries } from "./useEntries";

// One or two failures is someone fumbling their own passcode; a handful in a
// quarter hour is worth staff looking up.
const ALERT_FROM = 3;
// Only warn about the lockout once it's close enough to matter.
const MODAL =
  "m-auto w-[calc(100%-2rem)] max-w-[26rem] rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/45";

const MODAL_ACTION = "max-[480px]:w-full";

const SECONDARY = "border-border bg-surface text-text";

const SECTION_HEADING =
  "mx-0 mt-0 mb-2 text-base tracking-[0.04em] text-muted uppercase";

const EMPTY_NOTE =
  "m-0 rounded-xl border border-border bg-surface p-5 text-muted";

const BANNER =
  "m-0 rounded-lg border border-[#f0c48a] bg-[#fff4e5] px-[0.9rem] py-[0.6rem] text-[0.9rem] text-[#8a5200]";

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
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
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

  const sendToSheet = async () => {
    setSyncing(true);
    setSyncNote("");
    setDownloadError("");
    try {
      const rows = await syncSheet(passcode);
      setSyncNote(
        `Spreadsheet updated — ${rows} ${rows === 1 ? "entry" : "entries"}.`,
      );
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Could not update the spreadsheet.",
      );
    }
    setSyncing(false);
  };

  const exportSheet = () => {
    // Cleared first, or a failure from an earlier attempt sits on screen
    // looking like it belongs to this one. Same for the sync note, which
    // would otherwise read as confirmation of this download.
    setDownloadError("");
    setSyncNote("");
    return downloadCsv(passcode).catch(() =>
      setDownloadError("Could not download the spreadsheet."),
    );
  };

  if (!unlocked) {
    return (
      <main
        data-scale="kiosk"
        className="mx-auto flex max-w-[24rem] flex-col gap-5 pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] kiosk:max-w-[44rem]"
      >
        <form
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            session.unlock();
          }}
        >
          <h1 className="mx-0 mt-0 mb-1 text-[1.15rem] kiosk:text-[2rem]">
            Staff sign-in
          </h1>
          <p className="mt-1 mb-0 text-muted">
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
          {session.error && (
            <p className="m-0 text-[0.9rem] text-danger">{session.error}</p>
          )}
          {session.attemptsLeft !== null &&
            session.attemptsLeft <= REMAINING_WARN_FROM && (
              <p className="mx-0 mt-[-0.35rem] mb-0 text-[0.85rem] text-[#8a5200]">
                {session.attemptsLeft === 0
                  ? "No attempts left — this device is now locked for 15 minutes."
                  : `${session.attemptsLeft} ${session.attemptsLeft === 1 ? "attempt" : "attempts"} left before this device is locked out for 15 minutes.`}
              </p>
            )}
        </form>
        <p className="m-0 text-center text-[0.9rem] text-muted">
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
  // The month rolled over with last month's entries still on the board, so
  // they have not been exported yet.
  const monthToClose = unclosedMonth(entries.map((entry) => entry.createdAt));

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
    /* The seven-column table pins every column but the name, so the console
       needs the extra width to keep names and notes off three lines. */
    <main className="mx-auto flex max-w-[80rem] flex-col gap-5 pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-[1.6rem]">Queue admin</h1>
          <p className="mt-1 mb-0 text-muted">
            {allInRoom.length - beingHelped} waiting · {beingHelped} being
            helped ·{" "}
            {entries.filter((e) => e.status !== "resolved" && !e.due).length}{" "}
            scheduled later ·{" "}
            {entries.filter((e) => e.status === "resolved").length} done
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowBooking((shown) => !shown)}
            aria-expanded={showBooking}
          >
            {showBooking ? "Close" : "Book someone in"}
          </button>
          <button type="button" className={SECONDARY} onClick={exportSheet}>
            Download spreadsheet
          </button>
          <button
            type="button"
            className={SECONDARY}
            onClick={sendToSheet}
            disabled={syncing}
          >
            {syncing ? "Sending…" : "Send to Google Sheet"}
          </button>
          <button
            type="button"
            className={SECONDARY}
            onClick={() => handleSignOut()}
          >
            Sign out
          </button>
          {/* "Clear all" wipes the board; keep it off the elbow of "Sign out". */}
          <button
            type="button"
            className="ml-2 border-border bg-surface text-danger"
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

      {/* Reads as "who am I", not as another entry field. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <label htmlFor="helpedBy">Helping as</label>
        <input
          id="helpedBy"
          value={helpedBy}
          onChange={(event) => {
            setHelpedBy(event.target.value);
            localStorage.setItem("helpedBy", event.target.value);
          }}
          className="w-auto flex-[0_1_14rem]"
          placeholder="Your name, e.g. Kim"
          aria-describedby="helpedBy-hint"
        />
        <p
          id="helpedBy-hint"
          className="m-0 flex-[1_1_12rem] text-[0.85rem] text-muted"
        >
          {helpedBy.trim()
            ? `Entries you work on will be credited to ${helpedBy.trim()}.`
            : "Add your name so the queue shows who helped each person."}
        </p>
      </div>

      {offline && (
        <p className={BANNER} role="status">
          Can&rsquo;t reach the server — this list may be out of date.
        </p>
      )}

      {queue.rejected && queue.rejected.status !== 401 && (
        <p className={BANNER} role="status">
          {queue.rejected.message} The list has stopped refreshing.{" "}
          <button
            type="button"
            className="self-start bg-transparent p-0 text-accent underline pointer-coarse:min-h-[2.75rem]"
            onClick={queue.resume}
          >
            Try again
          </button>
        </p>
      )}

      {/* Hidden while the clear-all dialog is up, which shows its own copy on
          top of the backdrop. */}
      {syncNote && !confirmingClear && (
        <p className="m-0 text-[0.9rem] text-resolved" role="status">
          {syncNote}
        </p>
      )}

      {(queue.actionError || downloadError) && !confirmingClear && (
        <p className="m-0 text-[0.9rem] text-danger">
          {queue.actionError || downloadError}
        </p>
      )}

      {monthToClose && (
        <p
          className="m-0 rounded-lg border border-[#e5a3a3] border-l-4 border-l-[#c0392b] bg-[#fdecec] px-[0.9rem] py-[0.7rem] text-[0.9rem] leading-[1.45] text-[#7d2620]"
          role="status"
        >
          <strong>{monthToClose} is not closed out yet.</strong> Entries from
          then are still on the board. Download the spreadsheet before clearing
          — clearing deletes the records, and the CSV is the only copy kept.
        </p>
      )}

      {alerts && alerts.failedAttempts >= ALERT_FROM && (
        /* Louder than the offline banner: this one wants someone to act. */
        <p
          className="m-0 rounded-lg border border-[#e5a3a3] border-l-4 border-l-[#c0392b] bg-[#fdecec] px-[0.9rem] py-[0.7rem] text-[0.9rem] leading-[1.45] text-[#7d2620]"
          role="status"
        >
          <strong>{alerts.failedAttempts} failed sign-in attempts</strong> in
          the last {alerts.windowMinutes} minutes
          {alerts.lastAttemptAt &&
            `, most recent ${minutesAgo(alerts.lastAttemptAt)}`}
          . Check with the other admins — if it was none of them, rotate the
          passcode.
        </p>
      )}

      {/* Narrowing the three lists at once: the sections already split by
          status, so this filters on the things they don't. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <label className="sr-only" htmlFor="entry-search">
          Search by name or number
        </label>
        <input
          id="entry-search"
          type="search"
          className="w-auto flex-[1_1_16rem]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or #number"
        />
        <label className="sr-only" htmlFor="triage-filter">
          Triage level
        </label>
        <select
          id="triage-filter"
          className="w-auto flex-[0_1_12rem]"
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
        <label className="flex items-center gap-[0.4rem] font-normal whitespace-nowrap">
          <input
            className="min-h-0 w-auto"
            type="checkbox"
            checked={incompleteOnly}
            onChange={(event) => setIncompleteOnly(event.target.checked)}
          />
          Needs details ({incompleteCount})
        </label>
        {filtering && (
          <button
            type="button"
            className={`${SECONDARY} min-h-[2.25rem] px-[0.7rem] py-[0.35rem]`}
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
          <p
            className="m-0 flex-[1_1_100%] text-[0.85rem] text-muted"
            role="status"
          >
            {visible.length} of {entries.length} shown
          </p>
        )}
      </div>

      <section className="mt-2" aria-labelledby="active-heading">
        <h2 id="active-heading" className={SECTION_HEADING}>
          In the queue now ({inRoom.length})
        </h2>
        {!loaded ? (
          <p className={EMPTY_NOTE}>Loading entries…</p>
        ) : inRoom.length === 0 ? (
          <p className={EMPTY_NOTE}>
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
        <section className="mt-2" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className={SECTION_HEADING}>
            Scheduled later ({upcoming.length})
          </h2>
          <p className="mx-0 mt-[-0.25rem] mb-2 text-muted">
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
        <section className="mt-2" aria-labelledby="resolved-heading">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="resolved-heading" className={`${SECTION_HEADING} m-0`}>
              Done ({resolved.length})
            </h2>
            <button
              type="button"
              className={SECONDARY}
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
        className={MODAL}
        onClose={() => setConfirmingClear(false)}
      >
        <h2 className="mx-0 mt-0 mb-2 text-[1.2rem]">
          Clear all {entries.length}{" "}
          {entries.length === 1 ? "entry" : "entries"}?
        </h2>
        <p className="mx-0 mt-0 mb-5 text-muted">
          This empties the board for a fresh start and numbering begins again at
          #1. It cannot be undone — download the spreadsheet first if you need a
          record of today.
        </p>
        {downloadError && (
          <p className="m-0 text-[0.9rem] text-danger">{downloadError}</p>
        )}
        {/* Keeps DOM order on mobile so the recommended first step (download)
            stays first and the destructive action stays last. */}
        <div className="flex flex-wrap justify-end gap-2 max-[480px]:flex-col">
          <button
            type="button"
            className={`${SECONDARY} ${MODAL_ACTION}`}
            onClick={exportSheet}
          >
            Download spreadsheet
          </button>
          <button
            type="button"
            className={`${SECONDARY} ${MODAL_ACTION}`}
            onClick={() => setConfirmingClear(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`bg-danger text-white ${MODAL_ACTION}`}
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
        className={MODAL}
        onClose={() => setPendingDelete(null)}
      >
        {pendingDelete && (
          <>
            <h2 className="mx-0 mt-0 mb-2 text-[1.2rem]">
              Remove #{pendingDelete.id}?
            </h2>
            <p className="mx-0 mt-0 mb-5 text-muted">
              <strong>{pendingDelete.name}</strong> will be removed from the
              queue and from the CSV export. This cannot be undone.
            </p>
            <div className="flex flex-wrap justify-end gap-2 max-[480px]:flex-col-reverse">
              <button
                type="button"
                className={`${SECONDARY} ${MODAL_ACTION}`}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`bg-danger text-white ${MODAL_ACTION}`}
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
