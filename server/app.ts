import express from "express";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { createFailureLog } from "./alerts.js";
import {
  authConfig,
  isBootstrapOwner,
  readCookie,
  readSession,
  SESSION_COOKIE,
} from "./auth.js";
import { handleError, type Req } from "./http.js";
import { authRoutes } from "./routes/auth.js";
import { consoleRoutes } from "./routes/console.js";
import type { RouteContext } from "./routes/context.js";
import { entryRoutes } from "./routes/entries.js";
import { queueRoutes } from "./routes/queue.js";
import { staffRoutes } from "./routes/staff.js";
import { normalizeEmail, type Role, type StaffStore } from "./staff.js";
import type { Store } from "./store.js";

export { publicName } from "./publicEntry.js";

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
 * Builds the API. Pass `staticDir` in production to also serve the built
 * frontend from the same origin and port.
 * `allowRemoteAdmin` opens the console to addresses outside the local
 * network; leave it off unless something else is authenticating in front.
 *
 * The routes themselves live in `./routes`; what is assembled here is the
 * wiring they share — the limiters, the guards, and who a request is.
 */
export function createApp(
  store: Store,
  adminPasscode: string,
  staticDir?: string,
  allowRemoteAdmin = false,
  { staff }: { staff?: StaffStore } = {},
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

  // Sized for a whole waiting room, not one phone: behind NAT or a proxy every
  // visitor shares one address, so a per-device budget would throttle the room.
  const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many sign-ins from this device. Try again shortly.",
    },
  });

  // The board is the cheapest thing to hammer and the easiest to scrape, but a
  // waiting visitor polls it 12 times a minute and a roomful shares one address
  // behind NAT. 1200 leaves room for ~100 of them and still stops a script.
  const queueLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Try again shortly." },
  });

  // Hashing first gives both sides equal length, so the comparison itself
  // leaks nothing about how much of the passcode was correct.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expectedDigest = digest(adminPasscode);

  const failureLog = createFailureLog();

  /** The address a valid session cookie carries, before any allowlisting. */
  const signedInEmail = (req: Req) => {
    const auth = authConfig();
    if (!auth) return null;
    const token = readCookie(req.header("cookie"), SESSION_COOKIE);
    return readSession(token, auth.sessionSecret);
  };

  /**
   * What an address may do here: owner from the environment, whatever the
   * staff tab says otherwise, or null for anyone both leave out.
   */
  const roleForEmail = async (email: string): Promise<Role | null> => {
    const auth = authConfig();
    if (!auth) return null;
    if (isBootstrapOwner(auth, email)) return "owner";
    const member = (await staff?.list())?.find(
      (row) => row.email === normalizeEmail(email),
    );
    return member?.role ?? null;
  };

  /** Who this request is, and what they may do. */
  const identify = async (req: Req) => {
    const email = signedInEmail(req);
    if (!email) return null;
    const role = await roleForEmail(email);
    return role ? { email: normalizeEmail(email), role } : null;
  };

  /**
   * Whether this request came from the network staff actually sit on.
   *
   * A forwarded header the app was not told to trust is disqualifying: behind
   * an unconfigured proxy `req.ip` is the proxy's own address, which is
   * private, so every caller on the internet would otherwise look on-site.
   */
  const isOnSite = (req: Req) => {
    if (allowRemoteAdmin) return true;
    const forwarded = Boolean(req.header("x-forwarded-for"));
    if (forwarded && !app.get("trust proxy")) return false;
    return isLocalAddress(req.ip ?? "");
  };

  const requireAdmin: RequestHandler = (req, res, next) => {
    // Staff are on site, so an off-network caller has no business here at all
    // — and gets the same answer as a bad credential, learning nothing.
    if (!isOnSite(req)) {
      failureLog.note();
      res.status(401).json({ error: "Admin passcode required." });
      return;
    }

    // Google sign-in replaces the shared passcode wherever it is configured;
    // without it the console falls back to the passcode rather than locking
    // every deployment out the moment this shipped.
    if (authConfig()) {
      identify(req)
        .then((who) => {
          if (!who) {
            failureLog.note();
            res.status(401).json({ error: "Sign in with Google to continue." });
            return;
          }
          next();
        })
        .catch(next);
      return;
    }

    const supplied = req.header("x-admin-passcode") ?? "";
    if (!adminPasscode || !timingSafeEqual(digest(supplied), expectedDigest)) {
      failureLog.note();
      res.status(401).json({ error: "Admin passcode required." });
      return;
    }
    next();
  };

  /**
   * Guards the staff list. Deliberately unavailable on a passcode-only
   * deployment: everyone there shares one credential, so there is no "certain
   * staff" to trust with it, and exposing it would let any console user grant
   * themselves permanent access.
   */
  const requireOwner: RequestHandler = (req, res, next) => {
    // The same network rule as the rest of the console; managing access must
    // not be reachable from somewhere the queue itself is not.
    if (!isOnSite(req)) {
      failureLog.note();
      res.status(401).json({ error: "Admin passcode required." });
      return;
    }
    if (!authConfig() || !staff) {
      res.status(501).json({
        error:
          "Managing staff access needs Google sign-in configured on the server.",
      });
      return;
    }
    identify(req)
      .then((who) => {
        if (!who) {
          failureLog.note();
          res.status(401).json({ error: "Sign in with Google to continue." });
          return;
        }
        if (who.role !== "owner") {
          res.status(403).json({
            error: "Only an owner can change who has access.",
          });
          return;
        }
        next();
      })
      .catch(next);
  };

  /**
   * Guards what belongs to running the clinic rather than to working the
   * queue. Where staff sign in with Google there are owners to hold it; on a
   * passcode deployment everyone shares one credential, so there is no line to
   * draw and any admin passes. Runs behind `requireAdmin`, which has already
   * settled the network and the session.
   */
  const requireOwnerOfRecords: RequestHandler = (req, res, next) => {
    if (!authConfig()) {
      next();
      return;
    }
    identify(req)
      .then((who) => {
        if (who?.role !== "owner") {
          res.status(403).json({ error: "Only an owner can do that." });
          return;
        }
        next();
      })
      .catch(next);
  };

  const context: RouteContext = {
    store,
    staff,
    adminLimiter,
    joinLimiter,
    queueLimiter,
    requireAdmin,
    requireOwner,
    requireOwnerOfRecords,
    identify,
    roleForEmail,
    noteFailure: failureLog.note,
    recentFailures: failureLog.recent,
  };

  app.use("/api/auth", authRoutes(context));
  app.use("/api/admin/staff", staffRoutes(context));
  app.use("/api", queueRoutes(context));
  app.use("/api", entryRoutes(context));
  app.use("/api/admin", consoleRoutes(context));

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
