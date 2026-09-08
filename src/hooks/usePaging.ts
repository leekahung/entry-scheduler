import { useState } from "react";

/** How many rows a page holds. */
export const PAGE_SIZE = 10;

/**
 * A list read a page at a time, by page number.
 *
 * The page is clamped rather than stored blindly: the rows underneath refresh
 * on every poll, so the page somebody is on can stop existing while they are
 * reading it, and falling back to the last page beats rendering nothing.
 */
export function usePaging<T>(rows: T[]) {
  const [asked, setAsked] = useState(1);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(asked, 1), pages);
  const start = (page - 1) * PAGE_SIZE;

  return {
    rows: rows.slice(start, start + PAGE_SIZE),
    page,
    pages,
    total: rows.length,
    /** One-based, for saying "11–20 of 34"; both 0 when there is nothing. */
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(start + PAGE_SIZE, rows.length),
    setPage: setAsked,
    /** For when the list becomes a different list — another tab, say. */
    reset: () => setAsked(1),
  };
}
