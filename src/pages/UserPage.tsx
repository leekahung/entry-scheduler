import { useCallback, useEffect, useRef, useState } from "react";
import type { JoinedEntry, QueueEntry, VisitorIntake } from "../shared/types";
import { fetchQueue, joinQueue } from "../shared/api";
import CheckInForm from "../kiosk/CheckInForm";
import QueueBoard from "../kiosk/QueueBoard";
import WaitingList from "../kiosk/WaitingList";
import { formatAppointment } from "../shared/time";
import { usePoll } from "../hooks/usePoll";
import ScrollToTop from "../shared/ScrollToTop";
import { ToastList, useToasts } from "../shared/toasts";

const POLL_MS = 5000;

/** Public sign-in screen: enter a name, check in, watch the line. */
export default function UserPage() {
  const [myId, setMyId] = useState<number | null>(() => {
    const saved = localStorage.getItem("entryId");
    return saved ? Number(saved) : null;
  });
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  // What the server said when this device checked in, kept so the ticket can
  // be drawn before the board has caught up — or when reading it fails.
  const [justJoined, setJustJoined] = useState<JoinedEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toasts = useToasts();
  const [offline, setOffline] = useState(false);
  // The kiosk rests on a start screen; the form only appears once someone
  // says they are here to check in.
  const [showForm, setShowForm] = useState(false);
  // Not in localStorage: a reload lands on the start screen, and a staff
  // mis-click back to Waiting cannot redraw the ticket over the next person.
  const [justFinished, setJustFinished] = useState(false);
  const ticketRef = useRef<HTMLElement>(null);
  // Set only by a check-in on this device, so returning to a page that still
  // holds a ticket does not pull focus out of wherever the visitor is.
  const justCheckedIn = useRef(false);
  // Until the first fetch lands, an empty queue is unknown, not empty.
  const [loaded, setLoaded] = useState(false);
  // The public queue only carries shortened names, so keep the visitor's own.
  const [myName, setMyName] = useState(
    () => localStorage.getItem("entryName") ?? "",
  );

  const loadQueue = useCallback(() => {
    fetchQueue()
      .then((entries) => {
        setQueue(entries);
        // Only from a board that was read. A removed entry is absent, not
        // resolved, so this is what clears its ticket.
        setJustJoined((held) =>
          held &&
          !entries.some(
            (entry) =>
              entry.id === held.id && entry.createdAt === held.createdAt,
          )
            ? null
            : held,
        );
        setOffline(false);
        setLoaded(true);
      })
      .catch(() => setOffline(true));
  }, []);

  usePoll(loadQueue, POLL_MS);

  async function handleSubmit(name: string, intake: VisitorIntake) {
    setSubmitting(true);
    // The failure stays up and the form stays filled, so the visitor can
    // retry without retyping.
    await toasts.track(
      {
        pending: "Checking you in\u2026",
        success: (id: number) => `You're checked in. You are #${id}.`,
        failure: {
          fallback:
            "We couldn't check you in. Please try again, or ask a member of staff.",
          offline:
            "Can't reach the server. Ask a member of staff to check you in.",
        },
      },
      async () => {
        // The visitor is checked in once this resolves, so nothing after may
        // throw: a false failure leads to a second ticket.
        const entry = await joinQueue(name, intake);
        localStorage.setItem("entryId", String(entry.id));
        localStorage.setItem("entryName", entry.name);
        // Numbering restarts at #1 after staff clear the board, so the id alone
        // can collide with a different person's later entry.
        localStorage.setItem("entryCreatedAt", entry.createdAt);
        justCheckedIn.current = true;
        setMyId(entry.id);
        setMyName(entry.name);
        // The ticket draws from this whether or not the board reads back. Not
        // merged into `queue`, which holds shortened names.
        setJustJoined(entry);
        setShowForm(false);
        setJustFinished(false);
        // The server orders the board, so read it back; a blip is not a failed
        // check-in, and the poll catches up.
        await fetchQueue()
          .then(setQueue)
          .catch(() => {});
        return entry.id;
      },
    );
    setSubmitting(false);
  }

  // Back to the start screen with nothing kept, including a visit that ended
  // meanwhile, so nobody is thanked for a visit that was not theirs.
  function cancelForm() {
    setShowForm(false);
    setJustFinished(false);
  }

  // Stable so the resolved-entry effect below can depend on it without
  // clearing the ticket again on every render.
  const forgetMyEntry = useCallback(() => {
    localStorage.removeItem("entryId");
    localStorage.removeItem("entryName");
    localStorage.removeItem("entryCreatedAt");
    setMyId(null);
    setMyName("");
    // Or the ticket would be drawn again from the entry this device used to
    // hold, over the form the next visitor is already filling in.
    setJustJoined(null);
  }, []);

  // Only people in the room: an appointment not yet due must not count as
  // ahead of anyone, or be named "up next".
  const waiting = queue.filter(
    (entry) => entry.status !== "resolved" && entry.due,
  );
  // Matched on id and sign-in time, since numbers are reused. A device with no
  // stored time claims no entry.
  const savedCreatedAt = localStorage.getItem("entryCreatedAt");
  // Being helped is the end of the visit: a resolved entry has left the line,
  // so its ticket goes too and the kiosk is ready for the next person.
  const onBoard = (entry: QueueEntry) =>
    entry.status !== "resolved" &&
    entry.id === myId &&
    entry.createdAt === savedCreatedAt;
  // The board's copy if present, else the check-in response, so an unreadable
  // board does not hide the ticket.
  const mine =
    queue.find(onBoard) ??
    (justJoined && onBoard(justJoined) ? justJoined : undefined);
  // Any number of people can be helped at once, so this is a list, not one
  // number. The queue arrives ordered, so `upNext` is the lowest waiting number.
  const beingHelped = waiting.filter((entry) => entry.status === "pending");
  // Someone already being helped is no longer waiting, so "up next" is the
  // lowest number still queued.
  const queued = waiting.filter((entry) => entry.status === "new");
  const upNext = queued[0];

  // Focus the new ticket once, keyed on its id, so polls do not steal focus.
  const ticketId = mine?.id;
  useEffect(() => {
    if (ticketId === undefined || !justCheckedIn.current) return;
    justCheckedIn.current = false;
    ticketRef.current?.focus();
  }, [ticketId]);

  // Once resolved, forget the stored keys, so a mis-click back to Waiting
  // cannot redraw the ticket over the next visitor.
  const settledId = queue.find(
    (entry) =>
      entry.status === "resolved" &&
      entry.id === myId &&
      entry.createdAt === savedCreatedAt,
  )?.id;
  useEffect(() => {
    if (settledId === undefined) return;
    forgetMyEntry();
    // Or the ticket would simply vanish mid-visit, which is what a visitor
    // holding the tablet sees as nothing happening at all.
    setJustFinished(true);
  }, [settledId, forgetMyEntry]);

  return (
    <main
      data-scale="kiosk"
      className="mx-auto flex max-w-[40rem] flex-col gap-5 pt-8 page-inset kiosk:max-w-kiosk"
    >
      <header>
        <h1 className="m-0 text-title kiosk:text-title-kiosk">Check in</h1>
        {/* Only true while the form is up: the start screen has no name to
            add yet, and the ticket says it better itself. */}
        {showForm && !mine && (
          <p className="mt-1 mb-0 text-muted">
            Add your name and someone will come help you.
          </p>
        )}
      </header>

      {offline && (
        <p className="banner banner-caution" role="status">
          Can&rsquo;t reach the server — this list may be out of date.
        </p>
      )}

      <QueueBoard beingHelped={beingHelped} upNext={upNext} mineId={mine?.id} />

      {/* The ticket carries no aria-live: focus moves to it as it appears,
          which is what announces it. A live region too would say it twice. */}
      {mine ? (
        <section
          ref={ticketRef}
          tabIndex={-1}
          // Named, or focus would land on a section announced as nothing.
          aria-label="Your ticket"
          className="mt-2 flex flex-col gap-1.5 rounded-xl border border-border border-l-[5px] border-l-accent bg-surface p-5"
        >
          {/* The board calls people by number, so the visitor needs to know
              which one is theirs. */}
          <p className="m-0 text-[1.9rem] leading-[1.1] font-extrabold tabular-nums kiosk:text-[2.5rem]">
            #{mine.id}
          </p>
          {/* Let a long name break, or it widens the page. */}
          <p className="m-0 text-[1.35rem] font-bold [overflow-wrap:anywhere] kiosk:text-title">
            {myName || mine.name}
          </p>
          {mine.scheduledFor && (
            <p className="mx-0 mt-1 mb-0 font-semibold text-accent">
              Appointment at {formatAppointment(mine.scheduledFor)}
            </p>
          )}
          <p className="m-0 text-muted">
            {mine.due
              ? "You’re checked in. Someone will come help you."
              : "You’re checked in. You join the line at your appointment time."}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {/* Clears only this device for the next person; unconfirmed, as
                nothing is lost. Opens the form directly. */}
            <button
              type="button"
              className="self-start bg-transparent p-0 text-accent underline"
              onClick={() => {
                forgetMyEntry();
                setShowForm(true);
              }}
            >
              Check someone else in
            </button>
          </div>
        </section>
      ) : !showForm && justFinished ? (
        /* Named by nobody: whoever walks up next reads whatever is on this
           screen, and the ticket already did the identifying while it
           mattered. Held until someone taps rather than timed out, since the
           start screen needs a tap either way. */
        <section
          role="status"
          className="mt-2 flex flex-col gap-2 rounded-xl border border-border border-l-[5px] border-l-accent bg-surface p-5"
        >
          <p className="m-0 text-[1.35rem] font-bold kiosk:text-title">
            You&rsquo;re all set
          </p>
          <p className="m-0 text-muted">Thanks for coming in.</p>
          <button
            type="button"
            className="mt-2 self-start"
            onClick={() => {
              setJustFinished(false);
              setShowForm(true);
            }}
          >
            Check someone else in
          </button>
        </section>
      ) : !showForm ? (
        <section className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          {/* Speaks to whoever is at the kiosk, about what they came to do. */}
          <button type="button" onClick={() => setShowForm(true)}>
            Check in
          </button>
        </section>
      ) : (
        <CheckInForm
          onSubmit={handleSubmit}
          onCancel={cancelForm}
          submitting={submitting}
        />
      )}

      <WaitingList waiting={waiting} loaded={loaded} mineId={mine?.id} />

      {/* Staff would otherwise have to know to type "#/admin" by hand. */}
      <p className="m-0 text-center text-meta text-muted">
        <a href="#/admin">Staff sign-in</a>
      </p>

      <ToastList toasts={toasts.toasts} onDismiss={toasts.dismiss} kiosk />
      <ScrollToTop />
    </main>
  );
}
