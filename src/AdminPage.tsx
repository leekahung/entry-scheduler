import { useEffect, useRef, useState } from "react";
import { MAX_NAME } from "../server/validate";
import {
  downloadCsv,
  missingForLog,
  type AdminEntry,
  type Priority,
  type Status,
} from "./api";
import AdminSignIn from "./AdminSignIn";
import AdminToolbar from "./AdminToolbar";
import BookingForm from "./BookingForm";
import ClearAllDialog from "./ClearAllDialog";
import { seedDraft, type EditorDraft } from "./EntryEditor";
import QueueFilters from "./QueueFilters";
import RemoveEntryDialog from "./RemoveEntryDialog";
import QueueTable from "./QueueTable";
import { minutesAgo, unclosedMonth } from "./time";
import type { EntryChanges } from "./useEntries";
import { useAdminSession } from "./useAdminSession";
import { useEntries } from "./useEntries";
import StaffAccess from "./StaffAccess";

// One or two failures is someone fumbling their own passcode; a handful in a
// quarter hour is worth staff looking up.
const ALERT_FROM = 3;
// Only warn about the lockout once it's close enough to matter.

const SECTION_HEADING =
  "mx-0 mt-0 mb-2 text-base tracking-label text-muted uppercase";

const EMPTY_NOTE =
  "m-0 rounded-xl border border-border bg-surface p-5 text-muted";

const BANNER = "banner banner-caution";

// Louder than BANNER: this one wants someone to act, not just to know.
const ALERT = "banner banner-alert";

/** Staff console: work the queue, book people in, export the full sheet. */
export default function AdminPage() {
  const session = useAdminSession();
  const { passcode, unlocked, sheetUrl } = session;
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
  const [downloadError, setDownloadError] = useState("");
  const [query, setQuery] = useState("");
  const [triage, setTriage] = useState<Priority | "">("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);

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

  if (!unlocked) return <AdminSignIn session={session} />;

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

  // `due` comes from the server, which also decides the order, so the split can
  // never disagree with the queue it is describing.
  const inRoom = visible.filter((e) => e.status !== "resolved" && e.due);
  // The line splits again by what staff are doing with it: someone already
  // being helped is not part of the queue anyone is waiting in.
  const inProgress = inRoom.filter((e) => e.status === "pending");
  const waitingNow = inRoom.filter((e) => e.status === "new");
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
    <main className="mx-auto flex max-w-[80rem] flex-col gap-5 pt-8 page-inset">
      <AdminToolbar
        entries={entries}
        inRoom={allInRoom.length}
        beingHelped={beingHelped}
        email={session.email}
        sheetUrl={sheetUrl}
        showBooking={showBooking}
        onToggleBooking={() => setShowBooking((shown) => !shown)}
        onExport={exportSheet}
        onSignOut={() => handleSignOut()}
        onClearAll={() => setConfirmingClear(true)}
      />

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

      {session.role === "owner" && <StaffAccess passcode={passcode} />}

      {/* Reads as "who am I", not as another entry field. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <label htmlFor="helpedBy">Helping as</label>
        <input
          id="helpedBy"
          value={helpedBy}
          maxLength={MAX_NAME}
          onChange={(event) => {
            setHelpedBy(event.target.value);
            localStorage.setItem("helpedBy", event.target.value);
          }}
          className="w-auto flex-[0_1_14rem]"
          placeholder="Your name, e.g. Kim"
          aria-describedby="helpedBy-hint"
        />
        <p id="helpedBy-hint" className="m-0 field text-meta text-muted">
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
            className="self-start bg-transparent p-0 text-accent underline"
            onClick={queue.resume}
          >
            Try again
          </button>
        </p>
      )}

      {(queue.actionError || downloadError) && !confirmingClear && (
        <p className="m-0 text-meta text-danger">
          {queue.actionError || downloadError}
        </p>
      )}

      {monthToClose && (
        <p className={ALERT} role="status">
          <strong>{monthToClose} is not closed out yet.</strong> Entries from
          then are still on the board. Download the spreadsheet before clearing
          — clearing empties the Google Sheet too, and the CSV is the only copy
          kept.
        </p>
      )}

      {alerts && alerts.failedAttempts >= ALERT_FROM && (
        <p className={ALERT} role="status">
          <strong>{alerts.failedAttempts} failed sign-in attempts</strong> in
          the last {alerts.windowMinutes} minutes
          {alerts.lastAttemptAt &&
            `, most recent ${minutesAgo(alerts.lastAttemptAt)}`}
          . Check with the other admins — if it was none of them, rotate the
          passcode.
        </p>
      )}

      <QueueFilters
        query={query}
        onQuery={setQuery}
        triage={triage}
        onTriage={setTriage}
        incompleteOnly={incompleteOnly}
        onIncompleteOnly={setIncompleteOnly}
        incompleteCount={incompleteCount}
        filtering={filtering}
        shown={visible.length}
        total={entries.length}
        onClear={() => {
          setQuery("");
          setTriage("");
          setIncompleteOnly(false);
        }}
      />

      {inProgress.length > 0 && (
        <section className="mt-2" aria-labelledby="in-progress-heading">
          <h2 id="in-progress-heading" className={SECTION_HEADING}>
            Being helped ({inProgress.length})
          </h2>
          <QueueTable
            rows={inProgress}
            caption="Entries a staff member is helping right now"
            {...tableProps}
          />
        </section>
      )}

      <section className="mt-2" aria-labelledby="waiting-heading">
        <h2 id="waiting-heading" className={SECTION_HEADING}>
          Waiting ({waitingNow.length})
        </h2>
        {!loaded ? (
          <p className={EMPTY_NOTE}>Loading entries…</p>
        ) : waitingNow.length === 0 ? (
          <p className={EMPTY_NOTE}>
            {/* Measured against every section, not just this one: a filter
                matching only someone being helped, booked later, or already
                done would otherwise be denied here while its table shows the
                match. */}
            {filtering
              ? visible.length === 0
                ? "No entries match these filters."
                : "Nobody waiting matches these filters."
              : entries.length === 0
                ? "No entries yet."
                : "Nobody is waiting — everyone has been helped."}
          </p>
        ) : (
          <QueueTable
            rows={waitingNow}
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
              className="btn-secondary"
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

      <ClearAllDialog
        open={confirmingClear}
        count={entries.length}
        downloadError={downloadError}
        onExport={exportSheet}
        onCancel={() => setConfirmingClear(false)}
        onConfirm={async () => {
          await queue.clearAll();
          setConfirmingClear(false);
          closeEditor();
        }}
      />

      <RemoveEntryDialog
        entry={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(entry) => {
          setPendingDelete(null);
          queue.remove(entry);
        }}
      />
    </main>
  );
}
