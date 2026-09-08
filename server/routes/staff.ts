import { Router } from "express";
import { authConfig, isBootstrapOwner } from "../lib/auth.js";
import { wrap } from "../lib/http.js";
import { isRole } from "../domain/staff.js";
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

  routes.get(
    "/",
    adminLimiter,
    requireOwner,
    wrap(async (req, res) => {
      const auth = authConfig();
      const who = await identify(req);
      const rows = (await staff?.list()) ?? [];
      res.json({
        you: who,
        // Named separately so the console can show they are not removable
        // here rather than offering a button that cannot work.
        bootstrapOwners: [...(auth?.allowed ?? [])],
        // A row for an address the environment already owns grants nothing —
        // `identify` answers "owner" before it reads the tab — so listing it
        // among the members would show that address twice.
        members: rows.filter(
          (member) => !auth || !isBootstrapOwner(auth, member.email),
        ),
        // ...but it must not become invisible either: dropped from the
        // environment later, a forgotten row would quietly grant access again.
        // Named here so the console can offer to clear it out.
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
      // Re-adding an address rewrites its row, so this is the other way to
      // reach the mistake the remove path already refuses: an owner who makes
      // themselves staff loses the panel that would put it back, and where
      // they are the only owner nobody else can either.
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
    wrap(async (req, res) => {
      const email = normalizeEmail(String(req.params.email));
      const who = await identify(req);
      const auth = authConfig();

      // Checked before the two guards below: clearing a leftover row takes
      // nobody's access away, because the environment still grants it. That
      // makes it safe even when the address is the caller's own.
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
