import { useEffect, useRef, useState } from "react";
import type { AdminEntry, Status, VisitType } from "../shared/types";
import { downloadCurrentList, downloadWorkbook } from "../shared/api";
import ScrollToTop from "../shared/ScrollToTop";
import { ToastList, useToasts } from "../shared/toasts";
import AdminBanners from "../admin/AdminBanners";
import AdminSignIn from "../admin/AdminSignIn";
import AdminToolbar from "../admin/AdminToolbar";
import BookingForm from "../admin/BookingForm";
import ConfirmDialog from "../admin/ConfirmDialog";
import HelpingAs from "../admin/HelpingAs";
import QueueFilters from "../admin/QueueFilters";
import { RefreshIcon } from "../admin/icons";
import { queueSections } from "../admin/queueSections";
import QueueTabs, { panelId, tabId } from "../admin/QueueTabs";
import EraseEntryDialog from "../admin/EraseEntryDialog";
import RemoveEntryDialog from "../admin/RemoveEntryDialog";
import QueueTable from "../admin/QueueTable";
import StaffAccess from "../admin/StaffAccess";
import { unclosedMonth } from "../shared/time";
import { useEntryEditor } from "../hooks/useEntryEditor";
import { useHelpedBy } from "../hooks/useHelpedBy";
import { useQueueFilters } from "../hooks/useQueueFilters";
import type { EntryChanges } from "../hooks/useEntries";
import { useAdminSession } from "../hooks/useAdminSession";
import { useEntries } from "../hooks/useEntries";
import { usePaging } from "../hooks/usePaging";
import Pagination from "../shared/Pagination";

/** Staff console: work the queue, book people in, export the full sheet. */
export default function AdminPage() {
  const session = useAdminSession();
  const { passcode, unlocked, sheetUrl } = session;
  // Records and access are an owner's; with the shared passcode there are no
  // owners to tell apart, so nothing is held back.
  const owner = session.role === "owner" || session.mode === "passcode";
  // Stricter than `owner`: managing access needs Google sign-in to have
  // someone to name, and the server refuses it outright without one.
  const manageStaff = session.role === "owner";
  const toasts = useToasts();
  const queue = useEntries(passcode, unlocked, toasts, owner);

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
  const [pendingErase, setPendingErase] = useState<AdminEntry | null>(null);
  const [savingMonths, setSavingMonths] = useState(false);

  // Through a ref so the effect fires on a new rejection, not on every render.
  const signOutRef = useRef(handleSignOut);
  signOutRef.current = handleSignOut;

  // A 401 ends the session. A 429 also stops the poll but is recoverable, so
  // it shows as a banner instead.
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
    await queue.saveMonths();
    setSavingMonths(false);
  };

  const exportSheet = () =>
    toasts.track(
      {
        pending: "Preparing the current list\u2026",
        success: "Current list downloaded.",
        failure: {
          fallback: "The server couldn't build the current list.",
          offline: "Can't reach the server. Nothing was downloaded.",
        },
      },
      () => downloadCurrentList(passcode),
    );

  const exportWorkbook = () =>
    toasts.track(
      {
        pending: "Preparing all months\u2026",
        success: "All months downloaded.",
        failure: {
          fallback: "The server couldn't build the months file.",
          offline: "Can't reach the server. Nothing was downloaded.",
        },
      },
      () => downloadWorkbook(passcode),
    );

  const sections = queueSections(
    filters.visible,
    queue.entries.length,
    filters.filtering,
  );
  const found = sections.find((tab) => tab.id === section) ?? sections[0];
  // Only the table pages; the tab count stays whole. Above the sign-in gate,
  // since a hook after an early return breaks the hook order.
  const page = usePaging(found.rows);
  const shown = { ...found, rows: page.rows };

  if (!unlocked) return <AdminSignIn session={session} />;

  const { entries, alerts, offline, loaded } = queue;

  // The whole board, unfiltered and without removed entries: a filter must
  // never look like people leaving the room.
  const onBoard = entries.filter((e) => !e.deletedAt);
  const allInRoom = onBoard.filter((e) => e.status !== "resolved" && e.due);
  const beingHelped = allInRoom.filter((e) => e.status === "pending").length;
  // The month rolled over with last month's entries still on the board, so
  // they have not been exported yet.
  const monthToClose = unclosedMonth(onBoard.map((entry) => entry.createdAt));

  const tableProps = {
    editing: editor.editing,
    onDraftChange: editor.setDraft,
    onToggleEdit: (entry: AdminEntry) => editor.toggle(entry, helpedBy.trim()),
    onStatus: (entry: AdminEntry, status: Status) =>
      queue.setStatus(entry, status, helpedBy.trim()),
    onVisitType: (entry: AdminEntry, visitType: VisitType) =>
      queue.setVisitType(entry, visitType),
    onSave: async (entry: AdminEntry, details: EntryChanges) => {
      const saved = await queue.saveDetails(entry, details);
      if (saved) editor.close();
      return saved;
    },
    onRemove: setPendingDelete,
    onRestore: queue.restore,
    onErase: setPendingErase,
    owner,
  };

  return (
    /* The seven-column table pins every column but the name, so the console
       needs the extra width to keep names and notes off three lines. */
    <main className="mx-auto flex max-w-[80rem] flex-col gap-5 pt-8 page-inset">
      <AdminToolbar
        entries={onBoard}
        inRoom={allInRoom.length}
        beingHelped={beingHelped}
        email={session.email}
        sheetUrl={sheetUrl}
        showBooking={showBooking}
        onToggleBooking={() => setShowBooking((shown) => !shown)}
        onExport={exportSheet}
        onExportWorkbook={exportWorkbook}
        owner={owner}
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
        monthToClose={monthToClose}
        alerts={alerts}
        mode={session.mode}
      />

      <QueueFilters
        query={filters.query}
        onQuery={(value) => {
          filters.setQuery(value);
          page.reset();
        }}
        visitType={filters.visitType}
        onVisitType={(value) => {
          filters.setVisitType(value);
          page.reset();
        }}
        filtering={filters.filtering}
        shown={filters.visible.length}
        total={entries.length}
        onClear={() => {
          filters.clear();
          page.reset();
        }}
      />

      {/* The sync sits beside the sections rather than in the header: it is
        about the record these tables are kept in, not about the console. */}
      <div className="flex flex-wrap items-end justify-between gap-2 border-border border-b">
        {/* After the last tab, not by the page steps, where it would read as
          one of them. */}
        <div className="flex flex-wrap items-end gap-2">
          <QueueTabs
            tabs={sections.map(({ id, label, rows }) => ({
              id,
              label,
              count: rows.length,
            }))}
            active={shown.id}
            onSelect={(id) => {
              setSection(id);
              // Another tab is another list, so it starts at its first page.
              page.reset();
            }}
          />
          {owner && (
            // Unboxed so it is not a fifth tab, but labelled, since an icon
            // alone is a guess; fixed width so "Syncing…" does not resize it.
            <button
              type="button"
              className="mb-2 inline-flex min-w-[8.5rem] items-center gap-2 border-0 bg-transparent p-0 pointer-fine:min-h-[1.9rem] text-meta font-semibold text-muted hover:text-text disabled:opacity-40"
              onClick={saveMonths}
              disabled={onBoard.length === 0 || savingMonths}
              title={
                onBoard.length === 0
                  ? "Nothing to sync — the board is empty."
                  : undefined
              }
            >
              <RefreshIcon
                className={
                  savingMonths
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {savingMonths ? "Syncing…" : "Sync this month"}
            </button>
          )}
        </div>
        <Pagination
          page={page.page}
          pages={page.pages}
          from={page.from}
          to={page.to}
          total={page.total}
          onPage={page.setPage}
          label={`${shown.label} pages`}
        />
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

      <EraseEntryDialog
        entry={pendingErase}
        onCancel={() => setPendingErase(null)}
        onConfirm={(entry, confirm) => {
          setPendingErase(null);
          queue.purge(entry, confirm);
        }}
      />

      <ToastList toasts={toasts.toasts} onDismiss={toasts.dismiss} />
      <ScrollToTop />
    </main>
  );
}
