import { todayLocal } from "./time";
import type {
  AdminEntry,
  CaseDetails,
  Intake,
  JoinedEntry,
  QueueEntry,
  StaffMember,
  StaffList,
  StaffRole,
  Status,
  VisitorIntake,
  VisitType,
} from "./types";

/** A failed request, carrying the status so 401 and 429 can be told apart. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Throws the server's own error message, or `fallback` where it gave none. */
async function failUnlessOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: string };
  throw new ApiError(body?.error ?? fallback, res.status);
}

async function parse<T>(res: Response): Promise<T> {
  await failUnlessOk(res, `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** The entry being acted on: its number, and when it was signed in. */
type EntryRef = { id: number; createdAt: string };

/** An entry's address with its sign-in time, so a reused number 404s. */
const entryPath = ({ id, createdAt }: EntryRef, action = "") =>
  `/api/entries/${id}${action}?createdAt=${encodeURIComponent(createdAt)}`;

const adminHeaders = (passcode: string) => ({
  "Content-Type": "application/json",
  "x-admin-passcode": passcode,
});

export async function joinQueue(
  name: string,
  intake: VisitorIntake,
): Promise<JoinedEntry> {
  return parse<JoinedEntry>(
    await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...intake }),
    }),
  );
}

export async function fetchQueue(): Promise<QueueEntry[]> {
  return parse<QueueEntry[]>(await fetch("/api/queue"));
}

/** Staff booking someone in, with an appointment time or as a walk-up. */
export async function bookEntry(
  passcode: string,
  booking: {
    name: string;
    note: string;
    scheduledFor: string;
    visitType: VisitType;
    helpedBy: string;
  } & Intake,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch("/api/admin/entries", {
      method: "POST",
      headers: adminHeaders(passcode),
      body: JSON.stringify(booking),
    }),
  );
}

/** What a save wrote: the month tabs touched, and how many rows went into them. */
export type ArchiveResult = { months: string[]; entries: number };

/**
 * Saves the board into a tab per month it spans, leaving the board as it is.
 * Admin only.
 */
export async function archiveMonths(passcode: string): Promise<ArchiveResult> {
  return parse<ArchiveResult>(
    await fetch("/api/entries/archive", {
      method: "POST",
      headers: adminHeaders(passcode),
    }),
  );
}

export type AuthMode = { google: boolean };

/** Whether this deployment signs staff in with Google or a shared passcode. */
export async function fetchAuthMode(): Promise<AuthMode> {
  return parse<AuthMode>(await fetch("/api/auth/mode"));
}

export type SignedIn = {
  email: string;
  role: StaffRole;
  /** What Google calls them, for "Helping as". Empty when it said nothing. */
  name: string;
  sheetUrl: string | null;
};

/** Who is signed in on this browser, or null when the cookie is absent. */
export async function fetchSignedInEmail(): Promise<SignedIn | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  const body = (await res.json()) as Partial<SignedIn>;
  return body.email
    ? {
        email: body.email,
        role: body.role === "owner" ? "owner" : "staff",
        name: body.name ?? "",
        sheetUrl: body.sheetUrl ?? null,
      }
    : null;
}

export async function signOutOfGoogle(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function fetchStaff(passcode: string): Promise<StaffList> {
  return parse<StaffList>(
    await fetch("/api/admin/staff", { headers: adminHeaders(passcode) }),
  );
}

export async function addStaff(
  passcode: string,
  email: string,
  role: StaffRole,
): Promise<StaffMember> {
  return parse<StaffMember>(
    await fetch("/api/admin/staff", {
      method: "POST",
      headers: adminHeaders(passcode),
      body: JSON.stringify({ email, role }),
    }),
  );
}

export async function removeStaff(
  passcode: string,
  email: string,
): Promise<void> {
  const res = await fetch(`/api/admin/staff/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: adminHeaders(passcode),
  });
  await failUnlessOk(res, "Could not remove access.");
}

export type PasscodeResult = {
  accepted: boolean;
  /** Server-side lockout, not a verdict on the passcode itself. */
  lockedOut: boolean;
  /** Tries left before lockout, or null if the server didn't say. */
  remaining: number | null;
  /** The clinic's spreadsheet, or null when Sheets is not configured. */
  sheetUrl: string | null;
};

/**
 * Checks a passcode without throwing on rejection.
 * Rejects only when the server is unreachable, so callers can tell a bad
 * passcode apart from a network blip.
 */
export async function verifyPasscode(
  passcode: string,
): Promise<PasscodeResult> {
  const res = await fetch("/api/admin/verify", {
    method: "POST",
    headers: adminHeaders(passcode),
  });
  const remaining = res.headers.get("ratelimit-remaining");
  const body = res.ok ? await res.json().catch(() => null) : null;
  return {
    accepted: res.ok,
    lockedOut: res.status === 429,
    remaining: remaining === null ? null : Number(remaining),
    sheetUrl: (body?.sheetUrl as string | null) ?? null,
  };
}

export type AdminAlerts = {
  failedAttempts: number;
  lastAttemptAt: string | null;
  windowMinutes: number;
  /** No staff spreadsheet is set up, so only the server's owners can sign in. */
  missingStaffSheet: boolean;
};

/** Failed sign-in attempts, so the console can warn staff someone is probing. */
export async function fetchAdminAlerts(passcode: string): Promise<AdminAlerts> {
  return parse<AdminAlerts>(
    await fetch("/api/admin/alerts", { headers: adminHeaders(passcode) }),
  );
}

export async function fetchAllEntries(passcode: string): Promise<AdminEntry[]> {
  return parse<AdminEntry[]>(
    await fetch("/api/entries", { headers: adminHeaders(passcode) }),
  );
}

export async function updateStatus(
  passcode: string,
  entry: EntryRef,
  status: Status,
  helpedBy: string,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch(entryPath(entry), {
      method: "PATCH",
      headers: adminHeaders(passcode),
      // A blank name never wipes the existing one, and going back to the queue
      // sends none: whoever clicked did not help them.
      body: JSON.stringify({
        status,
        ...(helpedBy && status !== "new" ? { helpedBy } : {}),
      }),
    }),
  );
}

/**
 * Saves the per-entry fields an admin can correct after the fact.
 * Partial, so a draft seeded minutes ago cannot overwrite others' changes.
 */
export async function updateDetails(
  passcode: string,
  entry: EntryRef,
  details: Partial<
    {
      helpedBy: string;
      adminNote: string;
      visitType: VisitType;
      scheduledFor: string;
    } & Intake &
      CaseDetails
  >,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch(entryPath(entry), {
      method: "PATCH",
      headers: adminHeaders(passcode),
      body: JSON.stringify(details),
    }),
  );
}

/** Patches only the visit type. */
export async function updateVisitType(
  passcode: string,
  entry: EntryRef,
  visitType: VisitType,
): Promise<AdminEntry> {
  return parse<AdminEntry>(
    await fetch(entryPath(entry), {
      method: "PATCH",
      headers: adminHeaders(passcode),
      body: JSON.stringify({ visitType }),
    }),
  );
}

export async function deleteEntry(
  passcode: string,
  entry: EntryRef,
): Promise<void> {
  const res = await fetch(entryPath(entry), {
    method: "DELETE",
    headers: adminHeaders(passcode),
  });
  await failUnlessOk(res, `Could not delete entry (${res.status})`);
}

/** Puts a removed entry back on the board. */
export async function restoreEntry(
  passcode: string,
  entry: EntryRef,
): Promise<void> {
  const res = await fetch(entryPath(entry, "/restore"), {
    method: "POST",
    headers: adminHeaders(passcode),
  });
  await failUnlessOk(res, `Could not restore entry (${res.status})`);
}

/**
 * Erases an entry outright, month tab included. Owners only.
 * The name is sent back for the server to check, so a request that did not
 * come from someone reading the dialog cannot land.
 */
export async function purgeEntry(
  passcode: string,
  entry: EntryRef,
  confirm: string,
): Promise<void> {
  const res = await fetch(entryPath(entry, "/record"), {
    method: "DELETE",
    headers: adminHeaders(passcode),
    body: JSON.stringify({ confirm }),
  });
  await failUnlessOk(res, `Could not erase entry (${res.status})`);
}

/** Downloads an export through an object URL so the passcode header is sent. */
async function download(
  passcode: string,
  path: string,
  name: string,
  extension: string,
): Promise<void> {
  const res = await fetch(path, {
    headers: adminHeaders(passcode),
  });
  await failUnlessOk(res, `Export failed (${res.status})`);

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${todayLocal()}.${extension}`;
  // Firefox and Safari need the link in the document, and revoking the URL
  // synchronously can abort the download before it commits.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The list as it stands, laid out like the sign-in log. */
export function downloadCurrentList(passcode: string): Promise<void> {
  return download(
    passcode,
    "/api/entries/current.xlsx",
    "current-list",
    "xlsx",
  );
}

/** The whole record as one file, a tab per month. */
export function downloadWorkbook(passcode: string): Promise<void> {
  return download(passcode, "/api/entries.xlsx", "all-months", "xlsx");
}
