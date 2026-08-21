import { useEffect, useState } from "react";
import { GENDERS, type Gender } from "../server/codes";
import { fetchQueue, joinQueue, STATUS_LABEL, type QueueEntry } from "./api";
import { todayLocal } from "./time";

const POLL_MS = 5000;
// Keep in sync with MAX_NAME / MAX_PHONE in server/validate.ts, which enforce
// the real limits.
const NAME_MAX = 80;
const PHONE_MAX = 30;
// A name field is short enough that a permanent counter is noise; only warn
// once someone is close to the cap.
const NAME_COUNTER_FROM = 60;

const TICKET_EDGE: Record<QueueEntry["status"], string> = {
  new: "border-l-new",
  pending: "border-l-pending",
  resolved: "border-l-resolved",
};

const BADGE_COLOR: Record<QueueEntry["status"], string> = {
  new: "text-new",
  pending: "text-pending",
  resolved: "text-resolved",
};

const BADGE =
  "whitespace-nowrap rounded-full border border-current px-2 py-[0.15rem] text-[0.75rem] font-bold uppercase tracking-[0.03em]";

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
    <main
      data-scale="kiosk"
      className="mx-auto flex max-w-[40rem] flex-col gap-5 pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] kiosk:max-w-[44rem]"
    >
      <header>
        <h1 className="m-0 text-[1.6rem] kiosk:text-[2rem]">Check in</h1>
        <p className="mt-1 mb-0 text-muted">
          Add your name and someone will come help you.
        </p>
      </header>

      {offline && (
        <p
          className="m-0 rounded-lg border border-[#f0c48a] bg-[#fff4e5] px-[0.9rem] py-[0.6rem] text-[0.9rem] text-[#8a5200]"
          role="status"
        >
          Can&rsquo;t reach the server — this list may be out of date.
        </p>
      )}

      {/* Deliberately not a live region: these numbers change as other people
          are helped, and announcing every change would talk over the visitor.
          Their own status is announced from the ticket below. */}
      {(beingHelped.length > 0 || upNext) && (
        <section className="mt-2 flex flex-wrap justify-around gap-4 rounded-xl border border-border bg-surface px-5 py-4 text-center">
          {beingHelped.length > 0 && (
            <div className="min-w-[8rem] flex-1">
              <p className="m-0 text-[0.8rem] font-bold tracking-[0.08em] text-muted uppercase">
                {beingHelped.length === 1
                  ? "Now being helped"
                  : `Now being helped (${beingHelped.length})`}
              </p>
              <p className="m-0 mt-[0.15rem] text-[2.75rem] leading-[1.1] font-extrabold text-accent tabular-nums kiosk:text-[3.5rem]">
                {beingHelped.map((entry) => `#${entry.id}`).join("  ")}
              </p>
            </div>
          )}
          {upNext && (
            <div className="min-w-[8rem] flex-1">
              <p className="m-0 text-[0.8rem] font-bold tracking-[0.08em] text-muted uppercase">
                Up next
              </p>
              <p className="m-0 mt-[0.15rem] text-[2.75rem] leading-[1.1] font-extrabold text-accent tabular-nums kiosk:text-[3.5rem]">
                #{upNext.id}
              </p>
            </div>
          )}
        </section>
      )}

      {mine ? (
        <section
          className={`mt-2 flex flex-col gap-[0.35rem] rounded-xl border border-border border-l-[5px] bg-surface p-5 ${TICKET_EDGE[mine.status]}`}
          aria-live="polite"
        >
          <p className="m-0 text-[1.9rem] leading-[1.1] font-extrabold tabular-nums kiosk:text-[2.5rem]">
            #{mine.id}
          </p>
          <p className="m-0 text-[1.35rem] font-bold kiosk:text-[1.6rem]">
            {myName || mine.name}
          </p>
          {mine.scheduledFor && mine.status !== "resolved" && (
            <p className="mx-0 mt-1 mb-0 font-semibold text-accent">
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
            <p className="m-0 text-muted">
              You&rsquo;ve been helped. Thanks for stopping by!
            </p>
          ) : (
            <p className="m-0 text-muted">
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
          <div className="mt-[0.35rem] flex flex-wrap items-center gap-3">
            {/* Only staff can take someone out of the line; this just clears
                this device so the next person can join on it. Deliberately
                unconfirmed: on a shared tablet the next visitor is standing
                there waiting, and nothing here is destructive. */}
            <button
              type="button"
              className="self-start bg-transparent p-0 text-accent underline pointer-coarse:min-h-[2.75rem]"
              onClick={forgetMyEntry}
            >
              Check someone else in
            </button>
          </div>
        </section>
      ) : (
        <form
          className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          onSubmit={handleSubmit}
        >
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
              className={`mt-[-0.25rem] mr-0 mb-0 ml-0 text-right text-[0.8rem] ${name.length >= NAME_MAX ? "font-semibold text-new" : "text-muted"}`}
            >
              {name.length >= NAME_MAX
                ? `Character limit reached (${NAME_MAX})`
                : `${NAME_MAX - name.length} characters left`}
            </p>
          )}

          <p className="mt-1 mb-0 text-muted">
            The rest is optional — it saves time later, and only staff see it.
          </p>

          <div className="flex flex-wrap gap-x-3 gap-y-2">
            <div className="flex flex-[1_1_12rem] flex-col gap-2">
              <label htmlFor="dob">Date of birth</label>
              <input
                id="dob"
                type="date"
                value={dob}
                onChange={(event) => setDob(event.target.value)}
                max={todayLocal()}
              />
            </div>
            <div className="flex flex-[1_1_12rem] flex-col gap-2">
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
            <option value="">—</option>
            {GENDERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? "Checking in…" : "Check in"}
          </button>
          {error && <p className="m-0 text-[0.9rem] text-danger">{error}</p>}
        </form>
      )}

      <section className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
        <h2 className="mx-0 mt-0 mb-1 text-[1.15rem]">
          Currently waiting{loaded ? ` (${waiting.length})` : ""}
        </h2>
        {!loaded ? (
          <p className="mt-1 mb-0 text-muted">Loading the line…</p>
        ) : waiting.length === 0 ? (
          <p className="mt-1 mb-0 text-muted">Nobody in line right now.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[0.4rem] p-0 kiosk:text-[1.125rem]">
            {waiting.map((entry) => (
              <li
                key={entry.id}
                className={`flex items-center gap-3 pointer-coarse:py-[0.15rem] ${
                  mine && entry.id === mine.id ? "font-bold" : ""
                }`}
              >
                <span className="min-w-[2.5rem] font-bold text-muted tabular-nums">
                  #{entry.id}
                </span>
                <span className="flex-1">{entry.name}</span>
                <span className={`${BADGE} ${BADGE_COLOR[entry.status]}`}>
                  {STATUS_LABEL[entry.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Staff would otherwise have to know to type "#/admin" by hand. */}
      <p className="m-0 text-center text-[0.85rem] text-muted">
        <a href="#/admin">Staff sign-in</a>
      </p>
    </main>
  );
}
