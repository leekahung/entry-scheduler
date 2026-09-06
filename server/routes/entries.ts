import { Router } from "express";
import { toCsv, toRows } from "../sheet/csv.js";
import { toXlsx } from "../sheet/xlsx.js";
import { currentMonth, monthTab } from "../sheet/archive.js";
import { isDue, queueOrder } from "../domain/entry.js";
import { wrap } from "../lib/http.js";
import {
  checkBooking,
  checkNewEntry,
  checkUpdate,
} from "../domain/validate.js";
import type { RouteContext } from "./context.js";

/** Admin only: the full records, status changes, deletion, and the exports. */
export function entryRoutes({
  store,
  adminLimiter,
  requireAdmin,
  requireOwnerOfRecords,
}: RouteContext): Router {
  const routes = Router();

  routes.get(
    "/entries",
    adminLimiter,
    requireAdmin,
    wrap(async (_req, res) => {
      const entries = await store.list();
      // `due` mirrors what the public board gets, so both views agree on who
      // has actually joined the line.
      const now = Date.now();
      res.json(
        [...entries]
          .sort(queueOrder(now))
          .map((entry) => ({ ...entry, due: isDue(entry, now) })),
      );
    }),
  );

  // Staff booking someone in — for an appointment, or for a walk-up who can't
  // work the sign-in screen themselves.
  routes.post(
    "/admin/entries",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const checked = checkNewEntry(req.body);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }
      const booking = checkBooking(req.body);
      if (!booking.ok) {
        res.status(400).json({ error: booking.error });
        return;
      }

      const { name, note, intake } = checked.value;
      res.status(201).json(await store.add(name, note, intake, booking.value));
    }),
  );

  // Copies the board into a tab per month it spans. Nothing comes off the
  // board: an ended month is filed away on its own at the next change.
  // Declared above `/entries/:id` so the two never compete to match.
  routes.post(
    "/entries/archive",
    adminLimiter,
    requireAdmin,
    requireOwnerOfRecords,
    wrap(async (_req, res) => {
      res.json(await store.sync());
    }),
  );

  routes.patch(
    "/entries/:id",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid entry id." });
        return;
      }

      const checked = checkUpdate(req.body);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }

      const updated = await store.update(id, checked.value);
      if (!updated) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.json(updated);
    }),
  );

  routes.delete(
    "/entries/:id",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || !(await store.remove(id))) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.status(204).end();
    }),
  );

  routes.get(
    "/entries.csv",
    adminLimiter,
    requireAdmin,
    wrap(async (_req, res) => {
      const entries = await store.list();
      const stamp = new Date().toISOString().slice(0, 10);
      // attachment() sets its own Content-Type from the extension, so it has to
      // come first or it drops the charset and non-ASCII names decode wrongly.
      res.attachment(`current-list-${stamp}.csv`);
      res.type("text/csv; charset=utf-8");
      // Excel ignores the charset header when a downloaded .csv is opened by
      // double-click and falls back to the system codepage, which mangles any
      // non-ASCII name. The BOM is what tells it the file is UTF-8.
      res.send(`\uFEFF${toCsv(entries)}`);
    }),
  );

  // The whole record as one workbook, a tab per month, laid out like the CSV.
  // The CSV is still the current list to paste into the log; this is the file
  // to keep.
  //
  // Owners only, unlike the CSV. The CSV holds the board, which every staff
  // member is already looking at; this holds every name, date of birth, phone
  // number and note the clinic has ever filed. Copying the board into its
  // month tabs is an owner's, so reading them all back has to be too.
  routes.get(
    "/entries.xlsx",
    adminLimiter,
    requireAdmin,
    requireOwnerOfRecords,
    wrap(async (_req, res) => {
      const months = await store.months();
      const stamp = new Date().toISOString().slice(0, 10);
      // A workbook with no sheets at all is one Excel refuses to open, so an
      // empty record downloads as this month's headings and nothing under them.
      const sheets = months.length
        ? months
        : [{ tab: monthTab(currentMonth()), entries: [] }];
      const book = toXlsx(
        sheets.map(({ tab, entries }) => ({
          name: tab,
          rows: toRows(entries),
        })),
      );
      res.attachment(`all-months-${stamp}.xlsx`);
      res.send(book);
    }),
  );

  return routes;
}
