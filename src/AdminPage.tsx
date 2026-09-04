import { useEffect, useRef, useState } from "react";
import {
  downloadCsv,
  type AdminEntry,
  type Priority,
  type Status,
} from "./api";
import AdminBanners from "./AdminBanners";
import AdminSignIn from "./AdminSignIn";
import AdminToolbar from "./AdminToolbar";
import BookingForm from "./BookingForm";
import ConfirmDialog from "./ConfirmDialog";
import HelpingAs from "./HelpingAs";
import { RefreshIcon } from "./icons";
import QueueFilters from "./QueueFilters";
import { queueSections } from "./queueSections";
import QueueTabs, { panelId, tabId } from "./QueueTabs";
import RemoveEntryDialog from "./RemoveEntryDialog";
import QueueTable from "./QueueTable";
import StaffAccess from "./StaffAccess";
import { unclosedMonth } from "./time";
import { useEntryEditor } from "./useEntryEditor";
import { useHelpedBy } from "./useHelpedBy";
import { useQueueFilters } from "./useQueueFilters";
import type { EntryChanges } from "./useEntries";
import { useAdminSession } from "./useAdminSession";
import { useEntries } from "./useEntries";

/** Staff console: work the queue, book people in, export the full sheet. */
export default function AdminPage() {
  const session = useAdminSession();
  const { passcode, unlocked, sheetUrl } = session;
  // Everything the clinic keeps — its records and who may reach them — is an
  // owner's. A passcode deployment has one shared credential and so no owners
  // to tell apart, and nothing is held back there.
  const owner = session.role === "owner" || session.mode === "passcode";
  // Stricter than `owner`: managing access needs Google sign-in to have
  // someone to name, and the server refuses it outright without one.
  const manageStaff = session.role === "owner";
  const queue = useEntries(passcode, unlocked);

  const { signedInAs, typedAs, setTypedAs, helpedBy } = useHelpedBy(
    session.name,
  );
  const editor = useEntryEditor();
  const filters = useQueueFilters(queue.entries);

  const [showBooking, setShowBooking] = useState(false);
  // Owners only, and closed until asked for: the access list is not part of
  // working the queue, and open by default it pushes the queue down the page.
  const [showStaff, setShowStaff] = useState(false);
  // Asked about, because signing out mid-shift on a shared console means
  // finding whoever is signed in and getting them back in.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [section, setSection] = useState("waiting");
  const [pendingDelete, setPendingDelete] = useState<AdminEntry | null>(null);
  // Which month tabs the last save wrote, so staff can see it landed.
  const [savedMonths, setSavedMonths] = useState<string[] | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [savingMonths, setSavingMonths] = useState(false);

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

  function handleSignOut(reason?: string) {
    session.signOut(reason);
    editor.close();
    setShowBooking(false);
  }

  const saveMonths = async () => {
    setSavingMonths(true);
    setSavedMonths(await queue.saveMonths());
    setSavingMonths(false);
  };

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

  // Counted off the full queue, not the filtered view: this line is the state
  // of the room, and a filter should never make people appear to leave it.
  const allInRoom = entries.filter((e) => e.status !== "resolved" && e.due);
  const beingHelped = allInRoom.filter((e) => e.status === "pending").length;
  // The month rolled over with last month's entries still on the board, so
  // they have not been exported yet.
  const monthToClose = unclosedMonth(entries.map((entry) => entry.createdAt));

  const sections = queueSections(
    filters.visible,
    entries.length,
    filters.filtering,
  );
  const shown = sections.find((tab) => tab.id === section) ?? sections[0];

  const tableProps = {
    editingId: editor.editingId,
    draft: editor.draft,
    initialDraft: editor.initialDraft,
    onDraftChange: editor.setDraft,
    onToggleEdit: (entry: AdminEntry) => editor.toggle(entry, helpedBy.trim()),
    onStatus: (entry: AdminEntry, status: Status) =>
      queue.setStatus(entry, status, helpedBy.trim()),
    onPriority: (entry: AdminEntry, priority: Priority) =>
      queue.setPriority(entry, priority),
    onSave: async (entry: AdminEntry, details: EntryChanges) => {
      const saved = await queue.saveDetails(entry, details);
      if (saved) editor.close();
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
        onSignOut={() => setConfirmingSignOut(true)}
        manageStaff={manageStaff}
        showStaff={showStaff}
        onToggleStaff={() => setShowStaff((shown) => !shown)}
      />

      {manageStaff && showStaff && <StaffAccess passcode={passcode} />}

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

      <HelpingAs
        signedInAs={signedInAs}
        typedAs={typedAs}
        onTypedAs={setTypedAs}
      />

      <AdminBanners
        offline={offline}
        rejected={queue.rejected}
        onResume={queue.resume}
        actionError={queue.actionError}
        downloadError={downloadError}
        savedMonths={savedMonths}
        onDismissSaved={() => setSavedMonths(null)}
        monthToClose={monthToClose}
        alerts={alerts}
      />

      <QueueFilters
        query={filters.query}
        onQuery={filters.setQuery}
        triage={filters.triage}
        onTriage={filters.setTriage}
        incompleteOnly={filters.incompleteOnly}
        onIncompleteOnly={filters.setIncompleteOnly}
        incompleteCount={filters.incompleteCount}
        filtering={filters.filtering}
        shown={filters.visible.length}
        total={entries.length}
        onClear={filters.clear}
      />

      {/* The sync sits beside the sections rather than in the header: it is
        about the record these tables are kept in, not about the console. */}
      <div className="flex flex-wrap items-end justify-between gap-2 border-border border-b">
        <QueueTabs
          tabs={sections.map(({ id, label, rows }) => ({
            id,
            label,
            count: rows.length,
          }))}
          active={shown.id}
          onSelect={setSection}
        />
        {owner && (
          <button
            type="button"
            className="btn-secondary mb-2 inline-flex items-center gap-2"
            onClick={saveMonths}
            disabled={entries.length === 0 || savingMonths}
          >
            <RefreshIcon
              className={savingMonths ? "animate-spin" : undefined}
            />
            {savingMonths ? "Syncing…" : "Sync List"}
          </button>
        )}
      </div>

      <section
        role="tabpanel"
        id={panelId(shown.id)}
        aria-labelledby={tabId(shown.id)}
        tabIndex={-1}
      >
        <QueueTable
          rows={shown.rows}
          caption={shown.caption}
          // Until the first fetch lands, an empty tab is unknown, not empty.
          empty={loaded ? shown.empty : "Loading entries…"}
          {...tableProps}
        />
      </section>

      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out?"
        body={
          session.mode === "google"
            ? "You will have to sign in with Google again before you can work the queue. Nobody leaves the board and nothing is lost."
            : "You will have to enter the passcode again before you can work the queue. Nobody leaves the board and nothing is lost."
        }
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onCancel={() => setConfirmingSignOut(false)}
        onConfirm={() => {
          setConfirmingSignOut(false);
          handleSignOut();
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
