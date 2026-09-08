import { PAGE_SIZE, usePaging } from "../hooks/usePaging";
import Pagination from "../shared/Pagination";
import { STATUS_LABEL, type QueueEntry } from "../shared/types";

const BADGE_COLOR: Record<QueueEntry["status"], string> = {
  new: "text-new",
  pending: "text-pending",
  resolved: "text-resolved",
};

const BADGE =
  "whitespace-nowrap rounded-full border border-current px-2 py-[0.15rem] text-fine font-bold uppercase tracking-label";

const ROW = "flex items-center gap-3 pointer-coarse:py-[0.15rem]";

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
  // The heading keeps the whole count; only the rows are handed out a page at
  // a time, so a full room does not push the rest of the screen away.
  const page = usePaging(waiting);
  // A page's worth of rows, always. The line moves while people are watching
  // it, and a card that grew and shrank under them would take the rest of the
  // screen with it — so a short page is padded out rather than closed up.
  const fillers = PAGE_SIZE - page.rows.length;
  const empty = loaded ? "Nobody in line right now." : "Loading the line…";

  return (
    <section
      aria-labelledby="waiting-heading"
      className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
    >
      <h2 id="waiting-heading" className="mx-0 mt-0 mb-1 text-lead">
        Currently waiting{loaded ? ` (${waiting.length})` : ""}
      </h2>
      <div className="relative">
        <ul className="m-0 flex list-none flex-col gap-[0.4rem] p-0 kiosk:text-lead">
          {page.rows.map((entry) => (
            <li
              key={entry.id}
              className={`${ROW} ${mineId === entry.id ? "font-bold" : ""}`}
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
          {/* The same markup rather than a measured height: a spacer in rem
              would have to be re-measured for the kiosk's larger type and for
              the padding a touch screen adds. This is exactly a row tall
              because it is one. */}
          {Array.from({ length: Math.max(fillers, 0) }, (_, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a spacer has nothing else to key on
              key={`filler-${index}`}
              aria-hidden
              className={`${ROW} invisible`}
            >
              <span className="min-w-[2.5rem] tabular-nums">#0</span>
              <span className="min-w-0 flex-1 truncate">—</span>
              <span className={BADGE}>{STATUS_LABEL.new}</span>
            </li>
          ))}
        </ul>
        {page.rows.length === 0 && (
          // Over the empty rows rather than in place of them, so the card is
          // the same size whether the room is full or nobody has arrived.
          <p className="absolute inset-0 m-0 text-muted">{empty}</p>
        )}
      </div>
      <Pagination
        page={page.page}
        pages={page.pages}
        from={page.from}
        to={page.to}
        total={page.total}
        onPage={page.setPage}
        label="Waiting list pages"
      />
    </section>
  );
}
