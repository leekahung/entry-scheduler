import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "node:path";
import { createGuards } from "./lib/guards.js";
import { handleError } from "./lib/http.js";
import { authRoutes } from "./routes/auth.js";
import { consoleRoutes } from "./routes/console.js";
import type { RouteContext } from "./routes/context.js";
import { entryRoutes } from "./routes/entries.js";
import { queueRoutes } from "./routes/queue.js";
import { staffRoutes } from "./routes/staff.js";
import type { StaffStore } from "./domain/staff.js";
import type { Store } from "./sheet/store.js";

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

  const guards = createGuards({
    adminPasscode,
    allowRemoteAdmin,
    staff,
    // Read per request: callers set `trust proxy` after createApp returns.
    trustsProxy: () => app.get("trust proxy"),
  });

  const context: RouteContext = {
    store,
    staff,
    adminLimiter,
    joinLimiter,
    queueLimiter,
    requireAdmin: guards.requireAdmin,
    requireOwner: guards.requireOwner,
    requireOwnerOfRecords: guards.requireOwnerOfRecords,
    identify: guards.identify,
    roleForEmail: guards.roleForEmail,
    noteFailure: guards.noteFailure,
    recentFailures: guards.recentFailures,
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
    app.use(
      express.static(root, {
        // Only what Vite fingerprints into assets/ may be held: those can
        // never go stale, since a change ships under a new name. Everything
        // else keeps its name across builds — index.html, and anything
        // dropped into the build unhashed — so a year-long copy of one could
        // not be replaced at all.
        setHeaders: (res, file) => {
          const fingerprinted = path
            .relative(root, file)
            .startsWith(`assets${path.sep}`);
          res.setHeader(
            "Cache-Control",
            fingerprinted ? "public, max-age=31536000, immutable" : "no-cache",
          );
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      // A path with a file extension is a missing asset, not a client-side
      // route: let it 404 rather than returning HTML the browser can't parse.
      if (path.extname(req.path)) return next();
      // sendFile does not go through the static handler above, so the rule
      // that index.html is never held has to be repeated here.
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(root, "index.html"));
    });
  }

  app.use(handleError);

  return app;
}
