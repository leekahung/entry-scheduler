import { existsSync } from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { authConfig } from "./auth.js";
import { googleTransport, sheetsConfig } from "./sheets.js";
import { createStore } from "./store.js";
import { createStaffStore } from "./staff.js";

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

// Reachable from anywhere with no Google sign-in would leave one shared
// passcode as the whole security of the console. Refusing to start is the
// only way that cannot happen by accident: losing the OAuth settings must
// break the deployment loudly, not quietly downgrade how staff are let in.
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

// Each month the board spans is kept in its own tab. The live log stays the
// first tab; a newly filed month goes in directly after it, pushing the older
// months further right.
const store = createStore(googleTransport(sheets), {
  openTab: (tab) =>
    googleTransport({ ...sheets, tab }, undefined, {
      createMissing: true,
      atIndex: 1,
    }),
});

// Who may use the console. Its own tab, and — where GOOGLE_STAFF_SHEETS_ID
// names one — its own spreadsheet: a tab cannot be kept from someone who can
// open the file, so a separate file shared only with owners is the only way
// the access list is not readable by everyone who can read the queue. The app
// creates the tab on first write, so a fresh deployment needs no setup.
const staffTab = process.env.GOOGLE_STAFF_TAB?.trim() || "Staff";
const staffSheetId =
  process.env.GOOGLE_STAFF_SHEETS_ID?.trim() || sheets.spreadsheetId;
const staff = createStaffStore(
  googleTransport(
    { ...sheets, spreadsheetId: staffSheetId, tab: staffTab },
    undefined,
    { createMissing: true },
  ),
);

// The console is closed to anything off the local network unless something
// else is authenticating in front of it.
if (auth) {
  console.log(
    `Staff sign in with Google; ${auth.allowed.size} owner(s) set on the server, plus the "${staffTab}" tab`,
  );
  if (staffSheetId === sheets.spreadsheetId) {
    console.warn(
      `The staff list shares a spreadsheet with the queue, so anyone who can open it can read who has access.\n` +
        "Set GOOGLE_STAFF_SHEETS_ID to a spreadsheet shared only with owners and this service account to keep it to them.",
    );
  }
  if (auth.allowed.size === 0) {
    console.warn(
      "ADMIN_EMAILS is empty — only addresses in the staff tab can sign in.",
    );
  }
}

const app = createApp(store, passcode, staticDir, allowRemoteAdmin, { staff });

// Only behind a proxy that sets X-Forwarded-For itself, such as Cloud Run.
// Off by default: with it on, anyone who can reach the port directly can forge
// an on-network address and walk past the admin gate.
const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
if (trustProxy > 0) {
  app.set("trust proxy", trustProxy);
  console.log(`Trusting ${trustProxy} proxy hop(s) for the client address`);
}

const server = app.listen(port, () => {
  console.log(`Entry scheduler listening on http://localhost:${port}`);
  console.log(`Queue stored in spreadsheet ${sheets.spreadsheetId}`);
  console.log(
    staticDir
      ? `Serving the built frontend from ${distDir}`
      : "API only (no build found)",
  );
});

// Cloud Run sends SIGTERM and kills the instance a few seconds later, and a
// write cut in half would leave the spreadsheet — the only copy of the queue —
// short of what it should hold. Stop taking new requests, let the ones already
// running finish, and never outstay the grace period.
const SHUTDOWN_GRACE_MS = 5000;
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    // A second signal is someone insisting; a dev hot reload sends one too.
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${signal} received — finishing in-flight requests`);
    server.close(() => process.exit(0));
    // unref so a quiet server still exits the moment close() completes.
    setTimeout(() => {
      console.warn("Shutdown grace expired — exiting with work still open");
      process.exit(0);
    }, SHUTDOWN_GRACE_MS).unref();
  });
}
