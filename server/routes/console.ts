import { Router } from "express";
import { ALERT_WINDOW_MS } from "../lib/alerts.js";
import { authConfig } from "../lib/auth.js";
import { wrap } from "../lib/http.js";
import { sheetsConfig } from "../sheet/sheets.js";
import type { RouteContext } from "./context.js";

/** What the console asks about itself: where the records are, and who is probing. */
export function consoleRoutes({
  adminLimiter,
  requireAdmin,
  requireOwnerOfRecords,
  identify,
  recentFailures,
  linkToTab,
  staff,
}: RouteContext): Router {
  const routes = Router();

  routes.post(
    "/verify",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const config = sheetsConfig();
      // Owners only, as on /api/auth/me, or the hidden button is a formality.
      const mayLink = !authConfig() || (await identify(req))?.role === "owner";
      // Null when Sheets is unconfigured, which is what makes the console fall
      // back to offering the current-list download instead of a link.
      res.json({
        ok: true,
        sheetUrl: config && mayLink ? await linkToTab(config) : null,
      });
    }),
  );

  // Warns of someone trying to get in. Owners only: reviewing access or
  // rotating the passcode is theirs to do.
  routes.get(
    "/alerts",
    adminLimiter,
    requireAdmin,
    requireOwnerOfRecords,
    (_req, res) => {
      const recent = recentFailures();
      res.json({
        failedAttempts: recent.length,
        lastAttemptAt: recent.length
          ? new Date(recent[recent.length - 1]).toISOString()
          : null,
        windowMinutes: ALERT_WINDOW_MS / 60_000,
        // Owners can sign in without one, but nobody else can be let in.
        missingStaffSheet: authConfig() !== null && !staff,
      });
    },
  );

  return routes;
}
