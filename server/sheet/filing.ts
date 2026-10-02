import {
  byMonth,
  mergeById,
  monthKey,
  monthTab,
  monthTabs,
} from "./archive.js";
import { type Entry, isRemoved } from "../domain/entry.js";
import { fromSheetValues, toMonthValues } from "./columns.js";
import type { TabStore } from "./sheets.js";

/** What a sync wrote, for the console to report back. */
export type SyncResult = { months: string[]; entries: number };

/** One month of the record, as the tab it is kept in. */
export type Month = { tab: string; entries: Entry[] };

/**
 * The month tabs the board is filed into.
 * Without `tabs` nothing is filed, and the board is the whole record.
 */
export function createFiling(tabs?: TabStore) {
  /**
   * Copies the board into a tab per month it spans, merging rather than
   * replacing so a month already filed away keeps its rows.
   */
  async function sync(entries: Entry[]): Promise<SyncResult> {
    if (!tabs) return { months: [], entries: 0 };
    const groups = [...byMonth(entries)];
    if (groups.length === 0) return { months: [], entries: 0 };

    // Only tabs that exist, under their own names: one range naming no sheet
    // can fail the whole batched read.
    const existing = monthTabs(await tabs.list());
    const archived = await tabs.read(
      groups
        .map(([key]) => existing.get(key))
        .filter((tab): tab is string => tab !== undefined),
    );

    // One batched read and write for the whole year, not a pair per month.
    const writes = groups.map(([key, rows]) => {
      // Back to the tab this month already lives in, where there is one, or a
      // second tab would be made for a month that already has one.
      const tab = existing.get(key) ?? monthTab(key);
      const merged = mergeById(fromSheetValues(archived.get(tab) ?? []), rows);
      return { tab, values: toMonthValues(merged), rows: rows.length };
    });
    await tabs.write(writes);

    return {
      months: writes.map(({ tab }) => tab),
      entries: writes.reduce((total, { rows }) => total + rows, 0),
    };
  }

  /**
   * Takes one entry out of its month tab, if it is there.
   * Matched on id and sign-in time, as `mergeById` keys them.
   */
  async function purge(going: Entry): Promise<void> {
    if (!tabs) return;
    // The spreadsheet's own name for that month, where it has one — the tab
    // `sync` would have filed into, which need not be the computed name.
    const tab = monthTabs(await tabs.list()).get(monthKey(going.createdAt));
    if (!tab) return;

    const filed = fromSheetValues((await tabs.read([tab])).get(tab) ?? []);
    const left = filed.filter(
      (row) => row.id !== going.id || row.createdAt !== going.createdAt,
    );
    // A row that was never filed costs a read and nothing more.
    if (left.length === filed.length) return;
    await tabs.write([{ tab, values: toMonthValues(left) }]);
  }

  /**
   * The record a month at a time, `board` and filed tabs together.
   * Board rows win over filed copies.
   */
  async function months(board: Entry[]): Promise<Month[]> {
    const onBoard = byMonth(board);
    const filed = tabs
      ? monthTabs(await tabs.list())
      : new Map<string, string>();
    const keys = [...new Set([...onBoard.keys(), ...filed.keys()])]
      .sort()
      .reverse();
    // Only months with a tab, under its own name, so the batched read cannot
    // fail on a missing sheet.
    const archived = tabs
      ? await tabs.read([...filed.values()])
      : new Map<string, (string | number)[][]>();

    return (
      keys
        .map((key) => {
          const rows = fromSheetValues(
            archived.get(filed.get(key) ?? "") ?? [],
          );
          // Named as the workbook should read it, whatever the spreadsheet
          // happens to call the tab it came from.
          return {
            tab: monthTab(key),
            // The workbook describes the clinic's work, so removed entries come
            // out here; only erasing takes them off the sheet.
            entries: mergeById(rows, onBoard.get(key) ?? []).filter(
              (entry) => !isRemoved(entry),
            ),
          };
        })
        // A month tab someone emptied by hand is a tab with nothing in it, and
        // an empty sheet in the workbook says less than no sheet at all.
        .filter((month) => month.entries.length > 0)
    );
  }

  return { sync, purge, months };
}
