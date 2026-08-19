import { useEffect, useState } from "react";
import { GENDERS, type Gender } from "../server/codes";
import { fetchQueue, joinQueue, STATUS_LABEL, type QueueEntry } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { todayLocal } from "./time";

const POLL_MS = 5000;
// Keep in sync with MAX_NAME / MAX_PHONE in server/validate.ts, which enforce
// the real limits.
const NAME_MAX = 80;
const PHONE_MAX = 30;
// A name field is short enough that a permanent counter is noise; only warn
// once someone is close to the cap.
const NAME_COUNTER_FROM = 60;

/** Public sign-in screen: enter a name, check in, watch your place in line. */
export default function UserPage() {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [phone, setPhone] = useState("");
  const [myId, setMyId] = useState<number | null>(() => {
    const saved = localStorage.getItem("entryId");
    return saved ? Number(saved) : null;
  });
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [offline, setOffline] = useState(false);
  // Until the first fetch lands, an empty queue is unknown, not empty.
  const [loaded, setLoaded] = useState(false);
  // The public queue only carries shortened names, so keep the visitor's own.
  const [myName, setMyName] = useState(
    () => localStorage.getItem("entryName") ?? "",
  );

  useEffect(() => {
    let active = true;
    const load = () =>
      fetchQueue()
        .then((entries) => {
          if (!active) return;
          setQueue(entries);
          setOffline(false);
          setLoaded(true);
        })
        .catch(() => active && setOffline(true));

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const entry = await joinQueue(name.trim(), {
        dob,
        gender,
        phone: phone.trim(),
      });
      localStorage.setItem("entryId", String(entry.id));
      localStorage.setItem("entryName", entry.name);
      // Numbering restarts at #1 after staff clear the board, so the id alone
      // can collide with a different person's later entry.
      localStorage.setItem("entryCreatedAt", entry.createdAt);
      setMyId(entry.id);
      setMyName(entry.name);
      setName("");
      setDob("");
      setGender("");
      setPhone("");
      setQueue(await fetchQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  function forgetMyEntry() {
    localStorage.removeItem("entryId");
    localStorage.removeItem("entryName");
    localStorage.removeItem("entryCreatedAt");
    setMyId(null);
    setMyName("");
  }

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
  const mine = queue.find(
    (entry) => entry.id === myId && entry.createdAt === savedCreatedAt,
  );
  // Any number of people can be helped at once, so this is a list, not one
  // number. The queue arrives ordered, so `upNext` is the lowest waiting number.
  const beingHelped = waiting.filter((entry) => entry.status === "pending");
  // Counted among the people still queued, not everyone on the board: someone
  // already being helped is not ahead in the line. Counting them made the
  // ticket say "3 people ahead of you" while the board named you as up next.
  const queued = waiting.filter((entry) => entry.status === "new");
  const upNext = queued[0];
  const ahead = mine ? queued.findIndex((entry) => entry.id === mine.id) : -1;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Check in</h1>
        <p className="subtle">Add your name and someone will come help you.</p>
      </header>

      {offline && (
        <p className="offline-banner" role="status">
          Can&rsquo;t reach the server — this list may be out of date.
        </p>
      )}

      {/* Deliberately not a live region: these numbers change as other people
          are helped, and announcing every change would talk over the visitor.
          Their own status is announced from the ticket below. */}
      {(beingHelped.length > 0 || upNext) && (
        <section className="now-serving">
          {beingHelped.length > 0 && (
            <div>
              <p className="now-serving-label">
                {beingHelped.length === 1
                  ? "Now being helped"
                  : `Now being helped (${beingHelped.length})`}
              </p>
              <p className="now-serving-number">
                {beingHelped.map((entry) => `#${entry.id}`).join("  ")}
              </p>
            </div>
          )}
          {upNext && (
            <div>
              <p className="now-serving-label">Up next</p>
              <p className="now-serving-number">#{upNext.id}</p>
            </div>
          )}
        </section>
      )}

      {mine ? (
        <section className={`ticket ticket-${mine.status}`} aria-live="polite">
          <p className="ticket-number">#{mine.id}</p>
          <p className="ticket-name">{myName || mine.name}</p>
          {mine.scheduledFor && mine.status !== "resolved" && (
            <p className="ticket-appointment">
              Appointment at{" "}
              {new Date(mine.scheduledFor).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
          {mine.status === "resolved" ? (
            <p className="ticket-status">
              You&rsquo;ve been helped. Thanks for stopping by!
            </p>
          ) : (
            <p className="ticket-status">
              {mine.status === "pending"
                ? "Someone is helping you now."
                : !mine.due
                  ? "You join the line at your appointment time."
                  : ahead === 0
                    ? "You're next!"
                    : ahead === 1
                      ? "1 person ahead of you."
                      : `${ahead} people ahead of you.`}
            </p>
          )}
          <div className="ticket-actions">
            {/* Only staff can take someone out of the line; this just clears
                this device so the next person can join on it. */}
            <button
              type="button"
              className="link-button"
              onClick={() => setConfirmingForget(true)}
            >
              Check someone else in
            </button>
          </div>
        </section>
      ) : (
        <form className="card" onSubmit={handleSubmit}>
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))}
            placeholder="e.g. Ada Lovelace"
            maxLength={NAME_MAX}
            autoComplete="name"
            required
            aria-describedby="name-count"
          />
          {/* Counters carry no aria-live: a per-keystroke countdown is pure
              noise for a screen reader, and aria-describedby already links
              them to their field. */}
          {name.length >= NAME_COUNTER_FROM && (
            <p
              id="name-count"
              className={`counter${name.length >= NAME_MAX ? " counter-full" : ""}`}
            >
              {name.length >= NAME_MAX
                ? `Character limit reached (${NAME_MAX})`
                : `${NAME_MAX - name.length} characters left`}
            </p>
          )}

          <p className="subtle">
            The rest is optional — it saves time later, and only staff see it.
          </p>

          <div className="field-row">
            <div className="field">
              <label htmlFor="dob">Date of birth</label>
              <input
                id="dob"
                type="date"
                value={dob}
                onChange={(event) => setDob(event.target.value)}
                max={todayLocal()}
              />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value.slice(0, PHONE_MAX))
                }
                placeholder="e.g. 503-555-0142"
                maxLength={PHONE_MAX}
                autoComplete="tel"
              />
            </div>
          </div>

          <label htmlFor="gender">Gender</label>
          <select
            id="gender"
            value={gender}
            onChange={(event) => setGender(event.target.value as Gender | "")}
          >
            <option value="">Prefer not to say</option>
            {GENDERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? "Checking in…" : "Check in"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      )}

      <section className="card">
        <h2>Currently waiting{loaded ? ` (${waiting.length})` : ""}</h2>
        {!loaded ? (
          <p className="subtle">Loading the line…</p>
        ) : waiting.length === 0 ? (
          <p className="subtle">Nobody in line right now.</p>
        ) : (
          <ul className="queue-list">
            {waiting.map((entry) => (
              <li
                key={entry.id}
                className={mine && entry.id === mine.id ? "is-me" : undefined}
              >
                <span className="queue-number">#{entry.id}</span>
                <span className="queue-name">{entry.name}</span>
                <span className={`badge badge-${entry.status}`}>
                  {STATUS_LABEL[entry.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Only this device forgets the ticket — the entry stays in the queue,
          but nothing on screen can find its way back to it. */}
      <ConfirmDialog
        open={confirmingForget}
        title="Hand this device to someone else?"
        body={
          myName
            ? `You are checked in as ${myName}. This screen will stop showing your place in line — you stay in the queue, but this device will not be able to find your number again.`
            : "This screen will stop showing your place in line. You stay in the queue, but this device will not be able to find your number again."
        }
        confirmLabel="Check someone else in"
        cancelLabel="Keep my place on screen"
        onConfirm={() => {
          setConfirmingForget(false);
          forgetMyEntry();
        }}
        onCancel={() => setConfirmingForget(false)}
      />

      {/* Staff would otherwise have to know to type "#/admin" by hand. */}
      <p className="staff-link">
        <a href="#/admin">Staff sign-in</a>
      </p>
    </main>
  );
}
