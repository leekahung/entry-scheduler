import { existsSync } from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const port = Number(process.env.PORT ?? 3001);
const passcode = process.env.ADMIN_PASSCODE ?? "";

if (!passcode) {
  console.error(
    "ADMIN_PASSCODE is not set — admin routes would reject every request.\n" +
      "Copy .env.example to .env, or run: ADMIN_PASSCODE=yourcode npm run dev",
  );
  process.exit(1);
}

// One shared passcode guards every admin action, so a short one is the whole
// security of the console.
const MIN_PASSCODE = 12;
if (passcode.length < MIN_PASSCODE) {
  console.error(
    `ADMIN_PASSCODE must be at least ${MIN_PASSCODE} characters (got ${passcode.length}).`,
  );
  process.exit(1);
}

// Present after `npm run build`; in dev the Vite server serves the UI instead.
const distDir = path.resolve(import.meta.dirname, "../dist");
const staticDir = existsSync(distDir) ? distDir : undefined;

const db = openDb(process.env.DB_FILE ?? "entries.db");

// The console is closed to anything off the local network unless something
// else is authenticating in front of it.
const allowRemoteAdmin = process.env.ALLOW_REMOTE_ADMIN === "true";
if (allowRemoteAdmin) {
  console.warn(
    "ALLOW_REMOTE_ADMIN is on — the admin console is reachable from any address.",
  );
}

createApp(db, passcode, staticDir, allowRemoteAdmin).listen(port, () => {
  console.log(`Entry scheduler listening on http://localhost:${port}`);
  console.log(
    staticDir
      ? `Serving the built frontend from ${distDir}`
      : "API only (no build found)",
  );
});
