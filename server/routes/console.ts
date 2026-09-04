import { Router } from "express";
import { ALERT_WINDOW_MS } from "../lib/alerts.js";
import { authConfig } from "../lib/auth.js";
import { wrap } from "../lib/http.js";
import { sheetUrl, sheetsConfig } from "../sheet/sheets.js";
import type { RouteContext } from "./context.js";

/** What the console asks about itself: where the records are, and who is probing. */
export function consoleRoutes({
  adminLimiter,
  requireAdmin,
  requireOwnerOfRecords,
  identify,
  recentFailures,
}: RouteContext): Router {
  const routes = Router();

  routes.post(
    "/verify",
    adminLimiter,
    requireAdmin,
    wrap(async (req, res) => {
      const config = sheetsConfig();
      // The same line /api/auth/me draws: the spreadsheet holds every month,
      // so its link is an owner's. Withholding it on one route and handing it
      // out on this one would leave the console's hidden button a formality.
      const mayLink = !authConfig() || (await identify(req))?.role === "owner";
      // Null when Sheets is unconfigured, which is what makes the console fall
      // back to offering the CSV download instead of a link.
      res.json({
        ok: true,
        sheetUrl: config && mayLink ? sheetUrl(config) : null,
      });
    }),
  );

  // Lets whoever is signed in notice someone probing the shared passcode.
  // Owners only: the warning asks someone to rotate the passcode or revoke a
  // person, and neither is a staff member's to do.
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
      });
    },
  );

  return routes;
}
