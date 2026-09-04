import type { RequestHandler } from "express";
import type { Req } from "../lib/http.js";
import type { Role, StaffStore } from "../domain/staff.js";
import type { Store } from "../sheet/store.js";

/** Who a request is, once the session and the staff list agree on it. */
export type Who = { email: string; role: Role };

/**
 * What every router is handed: the stores it reads, the limiters and guards
 * the app built, and the few questions about a request that more than one area
 * needs to ask. Assembled once in `createApp`, which stays the only place the
 * server's wiring lives.
 */
export type RouteContext = {
  store: Store;
  /** Absent on a deployment with no staff tab, which is why every use is optional. */
  staff?: StaffStore;
  adminLimiter: RequestHandler;
  joinLimiter: RequestHandler;
  queueLimiter: RequestHandler;
  /** On-site, and holding either a session or the passcode. */
  requireAdmin: RequestHandler;
  /** Owners only, and Google only: 501 where sign-in is not configured. */
  requireOwner: RequestHandler;
  /** Owners where there are owners to tell apart, and any admin where there are not. */
  requireOwnerOfRecords: RequestHandler;
  identify: (req: Req) => Promise<Who | null>;
  roleForEmail: (email: string) => Promise<Role | null>;
  /** Counts one more failed attempt towards the console's warning. */
  noteFailure: () => void;
  /** The failed attempts still inside the warning's window. */
  recentFailures: () => number[];
};
