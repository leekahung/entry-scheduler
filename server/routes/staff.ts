import { type RequestHandler, Router } from "express";
import { authConfig, isBootstrapOwner } from "../lib/auth.js";
import { wrap } from "../lib/http.js";
import { isRole } from "../domain/staff.js";
import {
  serviceAccountEmail,
  sheetUrl,
  sheetsConfig,
  staffSheetsConfig,
} from "../sheet/sheets.js";
import { isEmailish, normalizeEmail } from "../shared/email.js";
import type { RouteContext } from "./context.js";

/** Managing who may use the console. Owners only, Google only. */
export function staffRoutes({
  staff,
  adminLimiter,
  requireOwner,
  identify,
}: RouteContext): Router {
  const routes = Router();

  // Nowhere to write a change to. The list still reads, so owners can see why.
  const requireStaffSheet: RequestHandler = (_req, res, next) => {
    if (staff) {
      next();
      return;
    }
    res.status(501).json({
      error:
        "There is no staff spreadsheet yet, so nobody can be given access. See Staff access for how to set one up.",
    });
  };

  routes.get(
    "/",
    adminLimiter,
    requireOwner,
    wrap(async (req, res) => {
      const auth = authConfig();
      const who = await identify(req);
      const rows = (await staff?.list()) ?? [];
      const sheets = sheetsConfig();
      const staffSheets = sheets && staffSheetsConfig(sheets);
      const account =
        sheets && !staff ? await serviceAccountEmail(sheets) : null;
      res.json({
        you: who,
        // Owners only, like everything on this route: the file that decides
        // who may sign in. The file alone, which holds nothing but the list.
        sheetUrl: staffSheets ? sheetUrl(staffSheets) : null,
        // Where there is no staff spreadsheet, what owners need to make one:
        // the address it has to be shared with for this server to use it.
        missingSheet: staff ? null : { shareWith: account ? [account] : [] },
        // Named separately so the console can show they are not removable
        // here rather than offering a button that cannot work.
        bootstrapOwners: [...(auth?.allowed ?? [])],
        // An address the environment already owns gains nothing from a row, so
        // listing it would show it twice...
        members: rows.filter(
          (member) => !auth || !isBootstrapOwner(auth, member.email),
        ),
        // ...but a forgotten row would grant access again once dropped from the
        // environment, so name it for clearing out.
        redundantRows: auth
          ? rows
              .filter((member) => isBootstrapOwner(auth, member.email))
              .map((member) => member.email)
          : [],
      });
    }),
  );

  routes.post(
    "/",
    adminLimiter,
    requireOwner,
    requireStaffSheet,
    wrap(async (req, res) => {
      const email = normalizeEmail(String(req.body?.email ?? ""));
      const role = req.body?.role;
      if (!isEmailish(email)) {
        res.status(400).json({ error: "That is not a valid email address." });
        return;
      }
      if (!isRole(role)) {
        res.status(400).json({ error: "Role must be owner or staff." });
        return;
      }

      const auth = authConfig();
      if (auth && isBootstrapOwner(auth, email)) {
        res.status(400).json({
          error: `${email} is already an owner set on the server.`,
        });
        return;
      }

      const who = await identify(req);
      // An owner demoting themselves loses the panel to undo it, and nobody
      // else can if they are the only owner.
      if (who && email === who.email && role === "staff") {
        res.status(400).json({
          error: "You cannot change your own access to staff.",
        });
        return;
      }

      res.status(201).json(await staff?.add(email, role, who?.email ?? ""));
    }),
  );

  routes.delete(
    "/:email",
    adminLimiter,
    requireOwner,
    requireStaffSheet,
    wrap(async (req, res) => {
      const email = normalizeEmail(String(req.params.email));
      const who = await identify(req);
      const auth = authConfig();

      // Before the guards below: clearing a leftover row removes nobody's
      // access, so it is safe even for the caller's own address.
      if (auth && isBootstrapOwner(auth, email)) {
        if (await staff?.remove(email)) {
          res.status(204).end();
          return;
        }
        res.status(400).json({
          error: `${email} is an owner set on the server and cannot be removed here.`,
        });
        return;
      }

      // Removing yourself is never what was meant, and it is the one mistake
      // that takes away the ability to undo itself.
      if (who && email === who.email) {
        res.status(400).json({ error: "You cannot remove your own access." });
        return;
      }

      if (!(await staff?.remove(email))) {
        res.status(404).json({ error: "That address is not on the list." });
        return;
      }
      res.status(204).end();
    }),
  );

  return routes;
}
