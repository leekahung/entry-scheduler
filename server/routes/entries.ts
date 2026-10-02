import { Router } from "express";
import { toRows } from "../sheet/log.js";
import { toXlsx } from "../sheet/xlsx.js";
import { currentMonth, monthTab } from "../sheet/archive.js";
import { isDue, isRemoved, queueOrder } from "../domain/entry.js";
import { wrap, type Req } from "../lib/http.js";
import {
  checkBooking,
  checkNewEntry,
  checkUpdate,
} from "../domain/validate.js";
import type { RouteContext } from "./context.js";

/** The sign-in time sent with an entry's number, so a reused number 404s. */
const signedInAt = (req: Req) =>
  typeof req.query.createdAt === "string" ? req.query.createdAt : undefined;

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

  // Copies the board into its month tabs; nothing leaves the board. Declared
  // above `/entries/:id` so the two never compete.
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

      const updated = await store.update(id, checked.value, signedInAt(req));
      if (!updated) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.json(updated);
    }),
  );

  // Erases a record outright; nothing undoes it, so owners only, its own
  // route, and the caller must send the person's name for the server to check.
  routes.delete(
    "/entries/:id/record",
    adminLimiter,
    requireAdmin,
    requireOwnerOfRecords,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid entry id." });
        return;
      }

      const at = signedInAt(req);
      const going = (await store.list()).find(
        (entry) =>
          entry.id === id && (at === undefined || entry.createdAt === at),
      );
      if (!going) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }

      const confirm = (req.body as { confirm?: unknown })?.confirm;
      if (typeof confirm !== "string" || confirm.trim() !== going.name.trim()) {
        res.status(400).json({
          error: "Type the name exactly as it appears to erase this record.",
        });
        return;
      }

      if (!(await store.purge(id, at))) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.status(204).end();
    }),
  );

  routes.delete(
    "/entries/:id",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || !(await store.remove(id, signedInAt(req)))) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.status(204).end();
    }),
  );

  // Undoing a removal. Staff-level, like the removal it undoes: the row was
  // never gone, so this only clears the stamp that was hiding it.
  routes.post(
    "/entries/:id/restore",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (
        !Number.isInteger(id) ||
        !(await store.restore(id, signedInAt(req)))
      ) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.status(204).end();
    }),
  );

  // The list as it stands, for a record to be taken without opening Google
  // Sheets — and the only way to get one when Sheets is not configured.
  routes.get(
    "/entries/current.xlsx",
    adminLimiter,
    requireAdmin,
    wrap(async (_req, res) => {
      const entries = (await store.list()).filter((entry) => !isRemoved(entry));
      const stamp = new Date().toISOString().slice(0, 10);
      const book = toXlsx([{ name: "Current list", rows: toRows(entries) }]);
      res.attachment(`current-list-${stamp}.xlsx`);
      res.send(book);
    }),
  );

  // The whole record, a tab per month. Owners only: unlike the current list,
  // it holds every name, DOB and phone the clinic has filed.
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
