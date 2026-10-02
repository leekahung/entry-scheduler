import { existsSync } from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { authConfig } from "./lib/auth.js";
import { applyClinicZone } from "./lib/zone.js";
import {
  googleTabs,
  googleTransport,
  sheetsConfig,
  staffSheetsConfig,
  tabUrl,
} from "./sheet/sheets.js";
import { createStore } from "./sheet/store.js";
import { createStaffStore } from "./domain/staff.js";

// Before anything reads a date. Nothing imported above takes one at load, so
// this is early enough to decide what "today" and "this month" mean.
const zone = applyClinicZone();

// `||`, not `??`: a blank PORT= in a .env file is an empty string, which
// Number() turns into 0 and binds a random port.
const port = Number(process.env.PORT || 3001);
const passcode = process.env.ADMIN_PASSCODE ?? "";
const auth = authConfig();
const allowRemoteAdmin = process.env.ALLOW_REMOTE_ADMIN === "true";

// The console is closed to anything off the local network unless something
// else is authenticating in front of it.
if (allowRemoteAdmin) {
  console.warn(
    "ALLOW_REMOTE_ADMIN is on — the admin console is reachable from any address.",
  );
}

// One shared passcode reachable from anywhere is too weak; refuse to start
// rather than quietly downgrade when the OAuth settings go missing.
if (allowRemoteAdmin && !auth) {
  console.error(
    "ALLOW_REMOTE_ADMIN is on but Google sign-in is not configured.\n" +
      "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, SESSION_SECRET and ADMIN_EMAILS,\n" +
      "or turn ALLOW_REMOTE_ADMIN off and keep the console on the local network.",
  );
  process.exit(1);
}

// The session cookie is signed with this and its payload is readable, so a
// guessable secret lets anyone mint themselves a session as a listed owner.
const MIN_SESSION_SECRET = 32;
if (auth && auth.sessionSecret.length < MIN_SESSION_SECRET) {
  console.error(
    `SESSION_SECRET must be at least ${MIN_SESSION_SECRET} characters (got ${auth.sessionSecret.length}).\n` +
      "Generate one with: openssl rand -base64 32",
  );
  process.exit(1);
}

if (auth) {
  // Nothing reads it once Google sign-in is on, and a credential that looks
  // live but is not invites someone to rely on it.
  if (passcode) {
    console.warn(
      "ADMIN_PASSCODE is set but ignored — Google sign-in is configured. Remove it from the environment.",
    );
  }
} else {
  // The passcode is for development only: one credential, nothing to revoke
  // per person.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Google sign-in is not configured, and the shared passcode is not accepted in production.\n" +
        "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, SESSION_SECRET and ADMIN_EMAILS.",
    );
    process.exit(1);
  }

  if (!passcode) {
    console.error(
      "ADMIN_PASSCODE is not set — admin routes would reject every request.\n" +
        "Copy .env.example to .env, or run: ADMIN_PASSCODE=yourcode npm run dev",
    );
    process.exit(1);
  }
  // One shared passcode guards every admin action, so a short one is the
  // whole security of the console.
  const MIN_PASSCODE = 12;
  if (passcode.length < MIN_PASSCODE) {
    console.error(
      `ADMIN_PASSCODE must be at least ${MIN_PASSCODE} characters (got ${passcode.length}).`,
    );
    process.exit(1);
  }
}

// Present after `npm run build`; in dev the Vite server serves the UI instead.
const distDir = path.resolve(import.meta.dirname, "../dist");
const staticDir = existsSync(distDir) ? distDir : undefined;

// The spreadsheet is the database, so there is nothing to fall back to.
const sheets = sheetsConfig();
if (!sheets) {
  console.error(
    "GOOGLE_SHEETS_ID is not set — the queue is stored in the spreadsheet, so the server has nowhere to read or write.\n" +
      "Copy .env.example to .env and set it, along with GOOGLE_SA_EMAIL and GOOGLE_SA_KEY unless this host already runs as a service account.",
  );
  process.exit(1);
}

// Each month gets its own tab after the live log, newest month leftmost.
const store = createStore(googleTransport(sheets), {
  tabs: googleTabs(sheets),
});

// A spreadsheet of its own: editors of the queue's file could otherwise make
// themselves owners. The app creates the tab on first write.
const staffSheets = staffSheetsConfig(sheets);
const staff = staffSheets
  ? createStaffStore(
      googleTransport(staffSheets, undefined, { createMissing: true }),
    )
  : undefined;

if (auth) {
  console.log(
    staffSheets
      ? `Staff sign in with Google; ${auth.allowed.size} owner(s) set on the server, plus the "${staffSheets.tab}" tab`
      : `Staff sign in with Google; ${auth.allowed.size} owner(s) set on the server`,
  );
  // Runs regardless: the owners can still sign in, and the console tells them
  // what is missing. A deployment with neither lets nobody in at all.
  if (!staffSheets) {
    console.warn(
      "GOOGLE_STAFF_SHEETS_ID is not set — only the owners in ADMIN_EMAILS can sign in, and nobody can be given access.\n" +
        "Create a spreadsheet, share it as an Editor with this service account, and set GOOGLE_STAFF_SHEETS_ID to its id.",
    );
  }
  if (auth.allowed.size === 0) {
    console.warn(
      staffSheets
        ? "ADMIN_EMAILS is empty — only addresses in the staff tab can sign in."
        : "ADMIN_EMAILS is empty and there is no staff spreadsheet — nobody can sign in.",
    );
  }
}

// Warm up the ~2.7s auth client and first read now, while the instance is idle,
// not on the first visitor.
store.list().catch((error) => {
  // Only a warm-up: the first real request will try again and report properly.
  console.warn("Could not read the queue at startup:", error);
});

const app = createApp(store, passcode, staticDir, allowRemoteAdmin, {
  staff,
  // Each link opens its own tab: the log, or the staff list.
  linkToTab: (config) => tabUrl(config),
});

// Only behind a proxy that sets X-Forwarded-For, such as Cloud Run; otherwise
// anyone can forge an on-network address.
const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
if (trustProxy > 0) {
  app.set("trust proxy", trustProxy);
  console.log(`Trusting ${trustProxy} proxy hop(s) for the client address`);
}

const server = app.listen(port, () => {
  console.log(`Entry scheduler listening on http://localhost:${port}`);
  // Worth saying out loud: it decides which month tab a row is filed into.
  console.log(`Months and stamps are cut in ${zone}`);
  console.log(`Queue stored in spreadsheet ${sheets.spreadsheetId}`);
  console.log(
    staticDir
      ? `Serving the built frontend from ${distDir}`
      : "API only (no build found)",
  );
});

// Cloud Run kills the instance soon after SIGTERM, and a half-done write would
// lose queue rows: finish in-flight requests within the grace period.
const SHUTDOWN_GRACE_MS = 5000;
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    // A second signal is someone insisting; a dev hot reload sends one too.
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${signal} received — finishing in-flight requests`);
    // Filing an ended month away happens behind the response now, so a closed
    // listener is no longer proof that nothing is still writing.
    server.close(() => {
      store.settled().finally(() => process.exit(0));
    });
    // unref so a quiet server still exits the moment close() completes.
    setTimeout(() => {
      console.warn("Shutdown grace expired — exiting with work still open");
      process.exit(0);
    }, SHUTDOWN_GRACE_MS).unref();
  });
}
