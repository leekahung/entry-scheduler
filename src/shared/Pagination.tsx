// The base stylesheet makes every button a filled accent pill, so each of
// these has to undo it — the same thing the queue tabs do. Shorter than a
// standing button too: this is a control you glance at rather than reach for.
// Coarse pointers keep the full 2.75rem, since there it is a touch target.
//
// Border, fill and colour are left out and added per variant rather than set
// here and overridden: two utilities for one property are settled by the order
// Tailwind emits them in, not the order they are written in.
const BASE =
  "rounded-md py-[0.15rem] pointer-fine:min-h-[1.9rem] text-meta font-semibold";

// No border and no fill: the steps read as words rather than boxes.
// Transparent rather than surface-coloured so they disappear into the page as
// well as into the kiosk's card.
//
// Both are always there and the one that leads nowhere is disabled rather than
// hidden: the pair stays a fixed shape, and a step that is dimmed says the end
// of the list has been reached, where one that vanished would say only that
// something moved. Faded through opacity, which nothing else here sets — a
// colour utility would be racing `text-text` for the same property.
const STEP = `${BASE} border-0 bg-transparent px-[0.6rem] text-text disabled:opacity-40`;

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
 * Always rendered, both steps closed on a list that fits in one page: the
 * control appearing as a list crosses ten would move everything under it, and
 * a closed pair still says where the list begins and ends.
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
      // Right-aligned: the counter's width changes with the page ("11–20 of
      // 34" against "31–34 of 34"), and anchoring the row to the right end
      // keeps the two steps still while the text either side of them grows.
      // Where the control is already sized to its content, as at the end of
      // the console's tab strip, there is no free space and this does nothing.
      className="flex flex-wrap items-center justify-end gap-3 text-meta text-muted"
    >
      {/* No range to give on an empty list, and "0–0" reads as a mistake. */}
      <span>{total === 0 ? "0 of 0" : `${from}–${to} of ${total}`}</span>
      {/* Which page, said as a sentence rather than as a row of numbers: the
        list is read in order, so the two steps are what anyone reaches for and
        the rest was numbers nobody pressed. */}
      <span>
        Page {page} of {pages}
      </span>
      {/* The pair sits together, so moving back and forth is one place rather
        than two ends of a row. */}
      <span className="flex items-center gap-1">
        <button
          type="button"
          className={STEP}
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
        >
          Previous
        </button>
        <button
          type="button"
          className={STEP}
          onClick={() => onPage(page + 1)}
          disabled={page === pages}
        >
          Next
        </button>
      </span>
    </nav>
  );
}
