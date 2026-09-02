import type { QueueEntry } from "./api";

// The visitor's own number is on their ticket; this ties it to the board.
const YOU = "text-fine font-bold tracking-label-wide text-muted uppercase";

const PANEL_LABEL =
  "m-0 text-meta font-bold tracking-label-wide text-muted uppercase";

// Bare numerals: size and colour carry the distinction, so nothing is drawn
// around or under them.
const NUMERAL = "font-extrabold tabular-nums leading-[1.05]";
const NUMERAL_NEXT = `${NUMERAL} text-[3.4rem] text-accent kiosk:text-[4.25rem]`;
const NUMERAL_HELPED = `${NUMERAL} text-[2.3rem] kiosk:text-[2.9rem]`;
// Alternating hues so two numbers side by side never read as one. Both differ
// from the accent the "up next" numeral uses, so however many are being helped
// the two panels never meet in the same colour.
const HELPED_HUES = ["text-pending-alt", "text-pending"];

type Props = {
  beingHelped: QueueEntry[];
  upNext: QueueEntry | undefined;
  /** Marks whichever number on the board belongs to this device. */
  mineId: number | undefined;
};

/**
 * The numbers the room is called by: who is being helped, and who is next.
 * Deliberately not a live region — these change as other people are helped,
 * and announcing every change would talk over the visitor.
 */
export default function QueueBoard({ beingHelped, upNext, mineId }: Props) {
  if (beingHelped.length === 0 && !upNext) return null;

  return (
    <section className="mt-2 flex flex-wrap items-stretch justify-center gap-x-6 gap-y-5 rounded-xl border border-border bg-surface p-5 text-center">
      {beingHelped.length > 0 && (
        <div className="flex-[2_1_14rem]">
          <p className={PANEL_LABEL}>Now being helped</p>
          <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-3">
            {beingHelped.map((entry, index) => (
              <span key={entry.id} className="flex flex-col items-center">
                <span
                  className={`${NUMERAL_HELPED} ${
                    HELPED_HUES[index % HELPED_HUES.length]
                  }`}
                >
                  {entry.id}
                </span>
                {mineId === entry.id && <span className={YOU}>You</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {beingHelped.length > 0 && upNext && (
        /* Hidden once the two panels stack, where it would hang off the side
           of the card instead of separating anything. */
        <div
          aria-hidden
          className="hidden w-px self-stretch bg-border sm:block"
        />
      )}
      {upNext && (
        <div className="flex-[1_1_9rem]">
          <p className={PANEL_LABEL}>Up next</p>
          <div className="mt-2 flex flex-col items-center">
            <span className={NUMERAL_NEXT}>{upNext.id}</span>
            {mineId === upNext.id && <span className={YOU}>You</span>}
          </div>
        </div>
      )}
    </section>
  );
}
