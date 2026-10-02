// Undoes the base filled pill, like the queue tabs. Variants add border, fill
// and colour, since Tailwind's emit order settles clashing utilities.
const BASE =
  "rounded-md py-0.5 pointer-fine:min-h-[1.9rem] text-meta font-semibold";

// Unboxed words. Both steps always show, the dead one dimmed, so the pair keeps
// its shape and says the end was reached.
const STEP = `${BASE} border-0 bg-transparent px-2.5`;
// A live step is coloured and underlines on hover, like a link.
const LIVE_STEP = "text-accent hover:underline underline-offset-4";
// Faded as well as uncoloured, so it reads as spent without colour vision.
const SPENT_STEP = "text-text opacity-40";

type Props = {
  page: number;
  pages: number;
  /** One-based first and last row on this page, and how many there are. */
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
  /** Names the list, so two controls on one screen are told apart. */
  label: string;
};

/**
 * Where you are in a list, and the two steps either side of it.
 * Always rendered, so the control never appears and shifts the page.
 */
export default function Pagination({
  page,
  pages,
  from,
  to,
  total,
  onPage,
  label,
}: Props) {
  return (
    <nav
      aria-label={label}
      // Right-aligned, so the steps stay still as the counter's width changes.
      className="flex flex-wrap items-center justify-end gap-3 text-meta text-muted"
    >
      {/* No range to give on an empty list, and "0–0" reads as a mistake. */}
      <span>{total === 0 ? "0 of 0" : `${from}–${to} of ${total}`}</span>
      {/* A sentence, not page numbers: the list is read in order. */}
      <span>
        Page {page} of {pages}
      </span>
      {/* The pair sits together, so moving back and forth is one place rather
        than two ends of a row. */}
      <span className="flex items-center gap-1">
        <button
          type="button"
          className={`${STEP} ${page === 1 ? SPENT_STEP : LIVE_STEP}`}
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
        >
          Previous
        </button>
        <button
          type="button"
          className={`${STEP} ${page === pages ? SPENT_STEP : LIVE_STEP}`}
          onClick={() => onPage(page + 1)}
          disabled={page === pages}
        >
          Next
        </button>
      </span>
    </nav>
  );
}
