import express from "express";
import compression from "compression";
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
import { type SheetsConfig, sheetUrl } from "./sheet/sheets.js";
import type { Store } from "./sheet/store.js";

/**
 * Builds the API, and serves the built frontend too when given `staticDir`.
 * `allowRemoteAdmin` opens the console beyond the local network.
 * `linkToTab` makes spreadsheet links; the default skips asking Google.
 */
export function createApp(
  store: Store,
  adminPasscode: string,
  staticDir?: string,
  allowRemoteAdmin = false,
  {
    staff,
    linkToTab = async (config) => sheetUrl(config),
  }: {
    staff?: StaffStore;
    linkToTab?: (config: SheetsConfig) => Promise<string>;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  // Only the OAuth callback reads the query, and only flat strings; `qs`'s
  // nested parsing is surface on every public route and nothing uses it.
  app.set("query parser", "simple");
  // First, so it covers everything: the polled board's JSON shrinks ~16x.
  app.use(compression());
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

  // Per-app stores. Only failed auth counts, so the console's polling never
  // trips it.
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

  // One budget for every address, so a flood cannot starve the write queue.
  // Only a 400 is refunded: it never reached Sheets, unlike a 500.
  const joinCapLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: () => "all",
    skipFailedRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Sign-in is busy right now. Try again in a minute." },
  });

  // A roomful behind one NAT address polls 12/min each; 1200 fits ~100 of
  // them and still stops a scraper.
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
    linkToTab,
    adminLimiter,
    joinLimiter,
    joinCapLimiter,
    queueLimiter,
    requireAdmin: guards.requireAdmin,
    requireOwner: guards.requireOwner,
    requireOwnerOfRecords: guards.requireOwnerOfRecords,
    identify: guards.identify,
    roleForEmail: guards.roleForEmail,
    noteFailure: guards.noteFailure,
    recentFailures: guards.recentFailures,
  };

  // `no-cache` makes the browser revalidate its ETag, so an unchanged board is
  // a bodyless 304. `private` stops a shared cache on a venue LAN storing it.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-cache");
    next();
  });

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
        // Only fingerprinted assets/ may be cached for long; anything else
        // keeps its name across builds, so a long-held copy could never update.
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
