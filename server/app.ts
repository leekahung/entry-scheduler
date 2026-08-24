import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { toCsv } from "./csv.js";
import { sheetUrl, sheetsConfig } from "./sheets.js";
import {
  authConfig,
  cookie,
  isBootstrapOwner,
  readCookie,
  readSession,
  SESSION_COOKIE,
  SESSION_MS,
  signSession,
  STATE_COOKIE,
} from "./auth.js";
import { OAuth2Client } from "google-auth-library";
import { isDue, queueOrder, type Entry } from "./entry.js";
import type { Store } from "./store.js";
import {
  isEmailish,
  isRole,
  normalizeEmail,
  type Role,
  type StaffStore,
} from "./staff.js";
import { checkBooking, checkNewEntry, checkUpdate } from "./validate.js";

// How far back the console's failed-sign-in warning looks. In memory only:
// this is a warning light for staff on shift, not an audit log.
const ALERT_WINDOW_MS = 15 * 60 * 1000;
// A sustained attack must not grow this without bound; the exact count stops
// mattering long before the cap.
const MAX_TRACKED_FAILURES = 500;

/**
 * Sends a rejected handler to the error middleware.
 * Express 4 ignores a returned promise, so without this a Sheets outage would
 * leave the request hanging instead of answering.
 */
const wrap =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

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

  let failures: number[] = [];
  const recentFailures = () => {
    const cutoff = Date.now() - ALERT_WINDOW_MS;
    failures = failures.filter((at) => at > cutoff);
    return failures;
  };

  const noteFailure = () => {
    if (recentFailures().length < MAX_TRACKED_FAILURES) {
      failures.push(Date.now());
    }
  };

  /** The address a valid session cookie carries, before any allowlisting. */
  const signedInEmail = (req: Parameters<RequestHandler>[0]) => {
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
  const identify = async (req: Parameters<RequestHandler>[0]) => {
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
  const isOnSite = (req: Parameters<RequestHandler>[0]) => {
    if (allowRemoteAdmin) return true;
    const forwarded = Boolean(req.header("x-forwarded-for"));
    if (forwarded && !app.get("trust proxy")) return false;
    return isLocalAddress(req.ip ?? "");
  };

  const requireAdmin: RequestHandler = (req, res, next) => {
    // Staff are on site, so an off-network caller has no business here at all
    // — and gets the same answer as a bad credential, learning nothing.
    if (!isOnSite(req)) {
      noteFailure();
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
            noteFailure();
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
      noteFailure();
      res.status(401).json({ error: "Admin passcode required." });
      return;
    }
    next();
  };

  // --- Staff sign-in with Google, when it is configured. ---

  const oauthClient = (req: Parameters<RequestHandler>[0]) => {
    const auth = authConfig();
    if (!auth) return null;
    // Derived when unset so a LAN box or a dev machine needs no extra config;
    // Google still has to have the resulting URL registered either way.
    const redirectUri =
      auth.redirectUri ||
      `${req.protocol}://${req.get("host")}/api/auth/callback`;
    return {
      auth,
      redirectUri,
      client: new OAuth2Client({
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        redirectUri,
      }),
    };
  };

  // Lets the console show a Google button or a passcode box without guessing.
  app.get("/api/auth/mode", (_req, res) => {
    res.json({ google: authConfig() !== null });
  });

  app.get(
    "/api/auth/me",
    wrap(async (req, res) => {
      const who = await identify(req);
      if (!who) {
        res.status(401).json({ error: "Not signed in." });
        return;
      }
      const sheets = sheetsConfig();
      res.json({
        email: who.email,
        role: who.role,
        sheetUrl: sheets ? sheetUrl(sheets) : null,
      });
    }),
  );

  app.get("/api/auth/google", (req, res) => {
    const setup = oauthClient(req);
    if (!setup) {
      res.status(501).json({ error: "Google sign-in is not configured." });
      return;
    }
    // A signed nonce echoed back through Google, so someone else's callback
    // cannot start a session in this browser.
    const state = randomBytes(16).toString("base64url");
    res.setHeader(
      "set-cookie",
      cookie(STATE_COOKIE, state, {
        maxAge: 10 * 60 * 1000,
        secure: req.secure,
      }),
    );
    res.redirect(
      setup.client.generateAuthUrl({
        scope: ["openid", "email"],
        state,
        // Staff share machines; landing straight into the last account would
        // sign the wrong person's name against the work.
        prompt: "select_account",
      }),
    );
  });

  app.get(
    "/api/auth/callback",
    adminLimiter,
    wrap(async (req, res) => {
      const setup = oauthClient(req);
      if (!setup) {
        res.status(501).json({ error: "Google sign-in is not configured." });
        return;
      }

      // This is a browser navigation, so failures go back to the console with
      // something readable rather than leaving staff on a JSON error page.
      const fail = (reason: string) =>
        res.redirect(`/?authError=${encodeURIComponent(reason)}#/admin`);

      const expected = readCookie(req.header("cookie"), STATE_COOKIE);
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!code || !expected || req.query.state !== expected) {
        noteFailure();
        fail("Sign-in could not be verified. Please try again.");
        return;
      }

      let email = "";
      try {
        const { tokens } = await setup.client.getToken(code);
        const ticket = await setup.client.verifyIdToken({
          idToken: tokens.id_token ?? "",
          audience: setup.auth.clientId,
        });
        const payload = ticket.getPayload();
        // An unverified address proves nothing about who is holding it.
        if (payload?.email && payload.email_verified) email = payload.email;
      } catch (error) {
        // Swallowed otherwise: staff get a generic failure and the cause — a
        // wrong client secret, a reused code, a clock skew — is invisible.
        console.error(
          "Google sign-in exchange failed:",
          error instanceof Error ? error.message : error,
        );
        email = "";
      }

      const clearState = cookie(STATE_COOKIE, "", {
        maxAge: 0,
        secure: req.secure,
      });
      // Checked before a cookie is issued: letting an unlisted address hold a
      // session and fail every request afterwards reads as a broken sign-in.
      if (!email || !(await roleForEmail(email))) {
        noteFailure();
        res.setHeader("set-cookie", clearState);
        // Named plainly: an allowlist miss is an administrative problem, and
        // leaving staff guessing at a generic failure wastes everyone's time.
        fail(
          email
            ? `${email} is not on the staff list for this console.`
            : "Google did not confirm that address.",
        );
        return;
      }

      res.setHeader("set-cookie", [
        clearState,
        cookie(SESSION_COOKIE, signSession(email, setup.auth.sessionSecret), {
          maxAge: SESSION_MS,
          secure: req.secure,
        }),
      ]);
      res.redirect("/#/admin");
    }),
  );

  app.post("/api/auth/logout", (req, res) => {
    res.setHeader(
      "set-cookie",
      cookie(SESSION_COOKIE, "", { maxAge: 0, secure: req.secure }),
    );
    res.status(204).end();
  });

  // --- Managing who may use the console. Owners only, Google only. ---

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
      noteFailure();
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
          noteFailure();
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

  app.get(
    "/api/admin/staff",
    adminLimiter,
    requireOwner,
    wrap(async (req, res) => {
      const auth = authConfig();
      const who = await identify(req);
      res.json({
        you: who,
        // Named separately so the console can show they are not removable
        // here rather than offering a button that cannot work.
        bootstrapOwners: [...(auth?.allowed ?? [])],
        members: (await staff?.list()) ?? [],
      });
    }),
  );

  app.post(
    "/api/admin/staff",
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

      const who = await identify(req);
      res.status(201).json(await staff?.add(email, role, who?.email ?? ""));
    }),
  );

  app.delete(
    "/api/admin/staff/:email",
    adminLimiter,
    requireOwner,
    wrap(async (req, res) => {
      const email = normalizeEmail(String(req.params.email));
      const who = await identify(req);
      const auth = authConfig();

      // Removing yourself is never what was meant, and it is the one mistake
      // that takes away the ability to undo itself.
      if (who && email === who.email) {
        res.status(400).json({ error: "You cannot remove your own access." });
        return;
      }
      if (auth && isBootstrapOwner(auth, email)) {
        res.status(400).json({
          error: `${email} is an owner set on the server and cannot be removed here.`,
        });
        return;
      }

      if (!(await staff?.remove(email))) {
        res.status(404).json({ error: "That address is not on the list." });
        return;
      }
      res.status(204).end();
    }),
  );

  // --- Public: anyone can join the queue and see who is waiting. ---

  app.post(
    "/api/entries",
    joinLimiter,
    wrap(async (req, res) => {
      const checked = checkNewEntry(req.body);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }

      const { name, note, intake } = checked.value;
      const entry = await store.add(name, note, intake);
      // The full name goes back only to the visitor who just typed it.
      res.status(201).json({ ...publicView(entry), name: entry.name });
    }),
  );

  app.get(
    "/api/queue",
    queueLimiter,
    wrap(async (_req, res) => {
      const entries = await store.list();
      // One clock reading for the whole response, so ordering and the due flags
      // can never disagree about an appointment that comes due mid-request.
      const now = Date.now();
      res.json(
        // Copied first: this is the store's cached array, and sorting it in
        // place would reorder the rows a concurrent write is about to save.
        [...entries]
          .sort(queueOrder(now))
          .map((entry) => publicView(entry, now)),
      );
    }),
  );

  // --- Admin only: status changes, deletion, full records, CSV export. ---

  app.get(
    "/api/entries",
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
  app.post(
    "/api/admin/entries",
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

  app.patch(
    "/api/entries/:id",
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

  app.delete(
    "/api/entries/:id",
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

  // Empties the whole queue — guarded in the UI by a confirmation dialog.
  app.delete(
    "/api/entries",
    adminLimiter,
    requireAdmin,
    wrap(async (_req, res) => {
      res.json({ removed: await store.clear() });
    }),
  );

  app.get(
    "/api/entries.csv",
    adminLimiter,
    requireAdmin,
    wrap(async (_req, res) => {
      const entries = await store.list();
      const stamp = new Date().toISOString().slice(0, 10);
      // attachment() sets its own Content-Type from the extension, so it has to
      // come first or it drops the charset and non-ASCII names decode wrongly.
      res.attachment(`entries-${stamp}.csv`);
      res.type("text/csv; charset=utf-8");
      // Excel ignores the charset header when a downloaded .csv is opened by
      // double-click and falls back to the system codepage, which mangles any
      // non-ASCII name. The BOM is what tells it the file is UTF-8.
      res.send(`\uFEFF${toCsv(entries)}`);
    }),
  );

  app.post("/api/admin/verify", adminLimiter, requireAdmin, (_req, res) => {
    const config = sheetsConfig();
    // Null when Sheets is unconfigured, which is what makes the console fall
    // back to offering the CSV download instead of a link.
    res.json({ ok: true, sheetUrl: config ? sheetUrl(config) : null });
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
