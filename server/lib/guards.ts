import type { RequestHandler } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { createFailureLog } from "./alerts.js";
import {
  authConfig,
  isBootstrapOwner,
  readCookie,
  readSession,
  SESSION_COOKIE,
} from "./auth.js";
import type { Req } from "./http.js";
import { isLocalAddress } from "./net.js";
import type { Role, StaffStore } from "../domain/staff.js";
import { normalizeEmail } from "../shared/email.js";

/**
 * Who a request is and what it may do, as the middleware the routes hang off.
 * `trustsProxy` is asked per request rather than read once: callers set
 * `trust proxy` on the app after `createApp` has returned.
 */
export function createGuards({
  adminPasscode,
  allowRemoteAdmin,
  staff,
  trustsProxy,
}: {
  adminPasscode: string;
  allowRemoteAdmin: boolean;
  staff?: StaffStore;
  trustsProxy: () => unknown;
}) {
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
   * Whether this request came from the staff's local network.
   * An untrusted forwarded header disqualifies: behind an unconfigured proxy,
   * every caller would otherwise look on-site.
   */
  const isOnSite = (req: Req) => {
    if (allowRemoteAdmin) return true;
    const forwarded = Boolean(req.header("x-forwarded-for"));
    if (forwarded && !trustsProxy()) return false;
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

    // Google sign-in replaces the passcode wherever it is configured.
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

    // A second lock behind `index.ts`: production never falls back to one
    // shared secret.
    if (process.env.NODE_ENV === "production") {
      failureLog.note();
      res.status(501).json({
        error:
          "This console needs Google sign-in. The passcode is not accepted here.",
      });
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
   * Guards the staff list. Unavailable with the shared passcode, where any
   * console user could grant themselves permanent access.
   */
  const requireOwner: RequestHandler = (req, res, next) => {
    // The same network rule as the rest of the console; managing access must
    // not be reachable from somewhere the queue itself is not.
    if (!isOnSite(req)) {
      failureLog.note();
      res.status(401).json({ error: "Admin passcode required." });
      return;
    }
    if (!authConfig()) {
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
   * Guards running the clinic rather than working the queue: owners with
   * Google sign-in, any admin with the shared passcode.
   * Runs behind `requireAdmin`.
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

  return {
    identify,
    roleForEmail,
    isOnSite,
    requireAdmin,
    requireOwner,
    requireOwnerOfRecords,
    noteFailure: failureLog.note,
    recentFailures: failureLog.recent,
  };
}
