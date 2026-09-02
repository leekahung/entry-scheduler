import { STATUS_LABEL, type QueueEntry } from "./api";

const BADGE_COLOR: Record<QueueEntry["status"], string> = {
  new: "text-new",
  pending: "text-pending",
  resolved: "text-resolved",
};

const BADGE =
  "whitespace-nowrap rounded-full border border-current px-2 py-[0.15rem] text-fine font-bold uppercase tracking-label";

type Props = {
  /** Already filtered to the people actually in the line. */
  waiting: QueueEntry[];
  /** Until the first fetch lands, an empty queue is unknown, not empty. */
  loaded: boolean;
  /** Bolds this device's own row. */
  mineId: number | undefined;
};

/** Everyone in the line right now, by number and shortened name. */
export default function WaitingList({ waiting, loaded, mineId }: Props) {
  return (
    <section className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
      <h2 className="mx-0 mt-0 mb-1 text-lead">
        Currently waiting{loaded ? ` (${waiting.length})` : ""}
      </h2>
      {!loaded ? (
        <p className="mt-1 mb-0 text-muted">Loading the line…</p>
      ) : waiting.length === 0 ? (
        <p className="mt-1 mb-0 text-muted">Nobody in line right now.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[0.4rem] p-0 kiosk:text-lead">
          {waiting.map((entry) => (
            <li
              key={entry.id}
              className={`flex items-center gap-3 pointer-coarse:py-[0.15rem] ${
                mineId === entry.id ? "font-bold" : ""
              }`}
            >
              <span className="min-w-[2.5rem] font-bold text-muted tabular-nums">
                #{entry.id}
              </span>
              {/* Clipped rather than wrapped: the number is what the room is
                  called by, and letting one long name wrap over six lines
                  would push everyone else off the screen. min-w-0 is what
                  lets a flex item shrink below its content at all. */}
              <span className="min-w-0 flex-1 truncate" title={entry.name}>
                {entry.name}
              </span>
              <span className={`${BADGE} ${BADGE_COLOR[entry.status]}`}>
                {STATUS_LABEL[entry.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
