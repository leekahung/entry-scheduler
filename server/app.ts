import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { toCsv } from "./csv.js";
import { pushToSheet, sheetsConfig } from "./sheets.js";
import {
  addEntry,
  clearEntries,
  deleteEntry,
  isDue,
  listEntries,
  queueOrder,
  updateEntry,
  type Db,
  type Entry,
} from "./db.js";
import { checkBooking, checkNewEntry, checkUpdate } from "./validate.js";

// How far back the console's failed-sign-in warning looks. In memory only:
// this is a warning light for staff on shift, not an audit log.
const ALERT_WINDOW_MS = 15 * 60 * 1000;
// A sustained attack must not grow this without bound; the exact count stops
// mattering long before the cap.
const MAX_TRACKED_FAILURES = 500;

// Express's default handler renders the stack as HTML, leaking server paths
// and returning markup to callers that asked for JSON.
const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err?.status === "number" && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error(err);
  res
    .status(status)
    .json({ error: status === 500 ? "Something went wrong." : "Bad request." });
};

/**
 * True for loopback, private, and link-local addresses — the networks staff
 * are actually sitting on when they use the console.
 */
export function isLocalAddress(ip: string): boolean {
  // Node reports IPv4 clients as ::ffff:a.b.c.d on a dual-stack listener.
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (address === "::1") return true;
  if (/^127\./.test(address)) return true;
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true;
  if (/^169\.254\./.test(address)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address);
}

/**
 * Shortens a name for the shared queue display, so a screen anyone can see
 * (or photograph) shows "Ada L." rather than a full legal name.
 */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const last = parts[parts.length - 1];
  // Iterate by code point: last[0] would split a surrogate pair and render as
  // a replacement glyph for names outside the BMP.
  const initial = [...last][0].toUpperCase();
  return `${parts.slice(0, -1).join(" ")} ${initial}.`;
}

/**
 * Public view of an entry — no admin-only bookkeeping fields, no full name.
 * The triage level stays private: the board is visible to everyone waiting,
 * and labelling who was bumped ahead invites exactly the argument staff don't
 * need. The order itself already reflects it.
 */
function publicView(entry: Entry, now = Date.now()) {
  return {
    id: entry.id,
    name: publicName(entry.name),
    status: entry.status,
    createdAt: entry.createdAt,
    scheduledFor: entry.scheduledFor,
    // Sent rather than recomputed in the browser: the server already decides
    // the order from this, and a client clock that disagrees would draw a
    // board contradicting the queue it is showing.
    due: isDue(entry, now),
  };
}

/**
 * Builds the API. Pass `staticDir` in production to also serve the built
 * frontend from the same origin and port.
 * `allowRemoteAdmin` opens the console to addresses outside the local
 * network; leave it off unless something else is authenticating in front.
 */
export function createApp(
  db: Db,
  adminPasscode: string,
  staticDir?: string,
  allowRemoteAdmin = false,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          // The board is often served over plain HTTP on a venue LAN, where
          // upgrading same-origin assets to https breaks every one of them.
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(express.json());

  // Per-app stores, so one instance's counters never bleed into another's.
  // Successful requests are skipped: only failed auth accumulates, which
  // leaves the admin console's 5-second polling untouched.
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Wait a few minutes and try again." },
  });

  // Generous enough that nobody signing in by hand will hit it. Each phone on
  // the venue wifi is its own address; behind a reverse proxy this needs
  // `app.set("trust proxy", …)` or every visitor shares the proxy's budget.
  const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many sign-ins from this device. Try again shortly.",
    },
  });

  // The board is the cheapest thing to hammer and the easiest to scrape. A
  // waiting visitor polls 12 times a minute, so this only bites a script.
  const queueLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Try again shortly." },
  });

  // Hashing first gives both sides equal length, so the comparison itself
  // leaks nothing about how much of the passcode was correct.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expectedDigest = digest(adminPasscode);

  let failures: number[] = [];
  const recentFailures = () => {
    const cutoff = Date.now() - ALERT_WINDOW_MS;
    failures = failures.filter((at) => at > cutoff);
    return failures;
  };

  const requireAdmin: RequestHandler = (req, res, next) => {
    const supplied = req.header("x-admin-passcode") ?? "";
    // Staff are on site, so an off-network caller has no business here at all
    // — and gets the same answer as a bad passcode, learning nothing.
    const onSite = allowRemoteAdmin || isLocalAddress(req.ip ?? "");
    if (
      !onSite ||
      !adminPasscode ||
      !timingSafeEqual(digest(supplied), expectedDigest)
    ) {
      if (recentFailures().length < MAX_TRACKED_FAILURES) {
        failures.push(Date.now());
      }
      res.status(401).json({ error: "Admin passcode required." });
      return;
    }
    next();
  };

  // --- Public: anyone can join the queue and see who is waiting. ---

  app.post("/api/entries", joinLimiter, (req, res) => {
    const checked = checkNewEntry(req.body);
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }

    const { name, note, intake } = checked.value;
    const entry = addEntry(db, name, note, intake);
    // The full name goes back only to the visitor who just typed it.
    res.status(201).json({ ...publicView(entry), name: entry.name });
  });

  app.get("/api/queue", queueLimiter, (_req, res) => {
    // One clock reading for the whole response, so ordering and the due flags
    // can never disagree about an appointment that comes due mid-request.
    const now = Date.now();
    res.json(
      listEntries(db)
        .sort(queueOrder(now))
        .map((entry) => publicView(entry, now)),
    );
  });

  // --- Admin only: status changes, deletion, full records, CSV export. ---

  app.get("/api/entries", adminLimiter, requireAdmin, (_req, res) => {
    // `due` mirrors what the public board gets, so both views agree on who
    // has actually joined the line.
    const now = Date.now();
    res.json(
      listEntries(db)
        .sort(queueOrder(now))
        .map((entry) => ({ ...entry, due: isDue(entry, now) })),
    );
  });

  // Staff booking someone in — for an appointment, or for a walk-up who can't
  // work the sign-in screen themselves.
  app.post("/api/admin/entries", adminLimiter, requireAdmin, (req, res) => {
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
    res.status(201).json(addEntry(db, name, note, intake, booking.value));
  });

  app.patch("/api/entries/:id", adminLimiter, requireAdmin, (req, res) => {
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

    const updated = updateEntry(db, id, checked.value);
    if (!updated) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/entries/:id", adminLimiter, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !deleteEntry(db, id)) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    res.status(204).end();
  });

  // Empties the whole queue — guarded in the UI by a confirmation dialog.
  app.delete("/api/entries", adminLimiter, requireAdmin, (_req, res) => {
    res.json({ removed: clearEntries(db) });
  });

  app.get("/api/entries.csv", adminLimiter, requireAdmin, (_req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    // attachment() sets its own Content-Type from the extension, so it has to
    // come first or it drops the charset and non-ASCII names decode wrongly.
    res.attachment(`entries-${stamp}.csv`);
    res.type("text/csv; charset=utf-8");
    // Excel ignores the charset header when a downloaded .csv is opened by
    // double-click and falls back to the system codepage, which mangles any
    // non-ASCII name. The BOM is what tells it the file is UTF-8.
    res.send(`\uFEFF${toCsv(listEntries(db))}`);
  });

  // Mirrors the log into the clinic's spreadsheet, which is where staff
  // without a database read it. SQLite stays the source of truth.
  app.post(
    "/api/admin/sheets-sync",
    adminLimiter,
    requireAdmin,
    async (_req, res) => {
      const config = sheetsConfig();
      if (!config) {
        res.status(501).json({
          error:
            "Google Sheets is not configured on the server. Set GOOGLE_SHEETS_ID, GOOGLE_SA_EMAIL and GOOGLE_SA_KEY.",
        });
        return;
      }
      try {
        const { rows } = await pushToSheet(config, listEntries(db));
        res.json({ rows });
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error ? error.message : "Sheets push failed.",
        });
      }
    },
  );

  app.post("/api/admin/verify", adminLimiter, requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  // Lets whoever is signed in notice someone probing the shared passcode.
  app.get("/api/admin/alerts", adminLimiter, requireAdmin, (_req, res) => {
    const recent = recentFailures();
    res.json({
      failedAttempts: recent.length,
      lastAttemptAt: recent.length
        ? new Date(recent[recent.length - 1]).toISOString()
        : null,
      windowMinutes: ALERT_WINDOW_MS / 60_000,
    });
  });

  // Unknown API routes must 404 as JSON rather than fall through to the SPA.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  if (staticDir) {
    const root = path.resolve(staticDir);
    app.use(express.static(root));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      // A path with a file extension is a missing asset, not a client-side
      // route: let it 404 rather than returning HTML the browser can't parse.
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(root, "index.html"));
    });
  }

  app.use(handleError);

  return app;
}
