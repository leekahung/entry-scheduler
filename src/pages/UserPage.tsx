import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueEntry, VisitorIntake } from "../shared/types";
import { fetchQueue, joinQueue } from "../shared/api";
import CheckInForm from "../kiosk/CheckInForm";
import QueueBoard from "../kiosk/QueueBoard";
import WaitingList from "../kiosk/WaitingList";
import { formatAppointment } from "../shared/time";
import { usePoll } from "../hooks/usePoll";

const POLL_MS = 5000;

/** Public sign-in screen: enter a name, check in, watch the line. */
export default function UserPage() {
  const [myId, setMyId] = useState<number | null>(() => {
    const saved = localStorage.getItem("entryId");
    return saved ? Number(saved) : null;
  });
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [offline, setOffline] = useState(false);
  // The kiosk rests on a start screen; the form only appears once someone
  // says they are here to check in.
  const [showForm, setShowForm] = useState(false);
  // Survives a reload so a kiosk in use all day does not go back to inviting
  // the first check-in. Cancelling out of the form does reset it.
  const [checkedInBefore, setCheckedInBefore] = useState(
    () => localStorage.getItem("checkedInBefore") === "1",
  );
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
        setOffline(false);
        setLoaded(true);
      })
      .catch(() => setOffline(true));
  }, []);

  usePoll(loadQueue, POLL_MS);

  async function handleSubmit(name: string, intake: VisitorIntake) {
    setError("");
    setSubmitting(true);
    try {
      const entry = await joinQueue(name, intake);
      localStorage.setItem("entryId", String(entry.id));
      localStorage.setItem("entryName", entry.name);
      // Numbering restarts at #1 after staff clear the board, so the id alone
      // can collide with a different person's later entry.
      localStorage.setItem("entryCreatedAt", entry.createdAt);
      // Kept when the entry keys are cleared: it records that this device has
      // been used before, not who is currently checked in. Only backing out of
      // the form clears it.
      localStorage.setItem("checkedInBefore", "1");
      setCheckedInBefore(true);
      justCheckedIn.current = true;
      setMyId(entry.id);
      setMyName(entry.name);
      setQueue(await fetchQueue());
      // Last, and only once the refetch has landed: a blip here throws, and
      // closing the form first would strand the visitor on the start screen
      // with their entry made, no ticket, and the error unmounted with it.
      // Unmounting the form is also what clears the fields it was holding.
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // Backing out returns the kiosk to its untouched state, greeting and all.
  function cancelForm() {
    setShowForm(false);
    setError("");
    localStorage.removeItem("checkedInBefore");
    setCheckedInBefore(false);
  }

  // Stable so the resolved-entry effect below can depend on it without
  // clearing the ticket again on every render.
  const forgetMyEntry = useCallback(() => {
    localStorage.removeItem("entryId");
    localStorage.removeItem("entryName");
    localStorage.removeItem("entryCreatedAt");
    setMyId(null);
    setMyName("");
  }, []);

  // Only people actually in the line. An appointment still hours out is in the
  // queue but not here yet, and counting it would tell the room a stranger is
  // ahead of them — and could name them as "up next".
  const waiting = queue.filter(
    (entry) => entry.status !== "resolved" && entry.due,
  );
  // Match on id *and* creation time: after a clear-all, numbering restarts, so
  // a stale id would otherwise latch onto a stranger's entry. A device with no
  // stored time cannot prove which entry is its own, so it claims none.
  const savedCreatedAt = localStorage.getItem("entryCreatedAt");
  // Being helped is the end of the visit: a resolved entry has left the line,
  // so its ticket goes too and the kiosk is ready for the next person.
  const mine = queue.find(
    (entry) =>
      entry.status !== "resolved" &&
      entry.id === myId &&
      entry.createdAt === savedCreatedAt,
  );
  // Any number of people can be helped at once, so this is a list, not one
  // number. The queue arrives ordered, so `upNext` is the lowest waiting number.
  const beingHelped = waiting.filter((entry) => entry.status === "pending");
  // Someone already being helped is no longer waiting, so "up next" is the
  // lowest number still queued.
  const queued = waiting.filter((entry) => entry.status === "new");
  const upNext = queued[0];

  // Checking in swaps the form out for the ticket, which would otherwise drop
  // focus to the top of the page. Keyed on the id, so a poll that re-renders
  // the same ticket does not keep stealing focus back.
  const ticketId = mine?.id;
  useEffect(() => {
    if (ticketId === undefined || !justCheckedIn.current) return;
    justCheckedIn.current = false;
    ticketRef.current?.focus();
  }, [ticketId]);

  // Once the entry this device holds is resolved the visit is over, so the
  // stored keys go too. Left behind, a staff mis-click on Reopen would put
  // that ticket back over a form the next visitor is already filling in.
  const settledId = queue.find(
    (entry) =>
      entry.status === "resolved" &&
      entry.id === myId &&
      entry.createdAt === savedCreatedAt,
  )?.id;
  useEffect(() => {
    if (settledId !== undefined) forgetMyEntry();
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
          className="mt-2 flex flex-col gap-[0.35rem] rounded-xl border border-border border-l-[5px] border-l-accent bg-surface p-5"
        >
          {/* The board calls people by number, so the visitor needs to know
              which one is theirs. */}
          <p className="m-0 text-[1.9rem] leading-[1.1] font-extrabold tabular-nums kiosk:text-[2.5rem]">
            #{mine.id}
          </p>
          {/* A name is one long token as far as the browser is concerned, so
              it has to be allowed to break mid-word or it drags the whole
              page sideways. */}
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
          <div className="mt-[0.35rem] flex flex-wrap items-center gap-3">
            {/* Only staff can take someone out of the line; this just clears
                this device so the next person can join on it. Deliberately
                unconfirmed: on a shared tablet the next visitor is standing
                there waiting, and nothing here is destructive. It opens the
                form itself rather than resting on the start screen, which
                would ask the same question over again. */}
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
      ) : !showForm ? (
        <section className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          <button type="button" onClick={() => setShowForm(true)}>
            {checkedInBefore ? "Check someone else in" : "Check someone in"}
          </button>
        </section>
      ) : (
        <CheckInForm
          onSubmit={handleSubmit}
          onCancel={cancelForm}
          submitting={submitting}
          error={error}
        />
      )}

      <WaitingList waiting={waiting} loaded={loaded} mineId={mine?.id} />

      {/* Staff would otherwise have to know to type "#/admin" by hand. */}
      <p className="m-0 text-center text-meta text-muted">
        <a href="#/admin">Staff sign-in</a>
      </p>
    </main>
  );
}
