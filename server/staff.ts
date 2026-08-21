import type { SheetTransport } from "./store.js";

/** Owners may change who has access; staff may only work the queue. */
export const ROLES = ["owner", "staff"] as const;
export type Role = (typeof ROLES)[number];

export type StaffMember = {
  email: string;
  role: Role;
  /** Who granted the access, for a trail of who let whom in. */
  addedBy: string;
  addedAt: string;
};

/** How long the staff list is reused before going back to the spreadsheet. */
export const STAFF_CACHE_MS = 30_000;

const COLUMNS = ["email", "role", "addedBy", "addedAt"] as const;

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

/** Addresses are compared lower-cased, so case can never grant or deny twice. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Rejects anything that is not a single plausible address. */
export function isEmailish(email: string): boolean {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email);
}

export function toStaffValues(members: StaffMember[]): string[][] {
  return [
    [...COLUMNS],
    ...members.map((member) => [
      member.email,
      member.role,
      member.addedBy,
      member.addedAt,
    ]),
  ];
}

/**
 * Members as read back from the tab, keyed by header rather than position.
 * Rows without a usable address are skipped, so a note typed into the sheet
 * cannot grant anyone access.
 */
export function fromStaffValues(values: (string | number)[][]): StaffMember[] {
  const [header, ...rows] = values;
  if (!header) return [];

  const at = (row: (string | number)[], name: string) => {
    const index = header.findIndex((cell) => String(cell) === name);
    return index === -1 ? "" : String(row[index] ?? "");
  };

  const members: StaffMember[] = [];
  for (const row of rows) {
    const email = normalizeEmail(at(row, "email"));
    if (!isEmailish(email)) continue;
    const role = at(row, "role");
    members.push({
      email,
      // An unreadable role is the lesser privilege, never the greater one.
      role: isRole(role) ? role : "staff",
      addedBy: at(row, "addedBy"),
      addedAt: at(row, "addedAt"),
    });
  }
  return members;
}

export type StaffStore = {
  list(): Promise<StaffMember[]>;
  add(email: string, role: Role, addedBy: string): Promise<StaffMember>;
  remove(email: string): Promise<boolean>;
};

/**
 * Who may use the console, kept in its own tab of the same spreadsheet.
 *
 * Read on every admin request, so the list is cached; writes are queued
 * because a whole-tab rewrite has no transaction behind it.
 */
export function createStaffStore(transport: SheetTransport): StaffStore {
  let cache: StaffMember[] | null = null;
  let cachedAt = 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<StaffMember[]> {
    if (cache && Date.now() - cachedAt < STAFF_CACHE_MS) return cache;
    const members = fromStaffValues(await transport.read());
    cache = members;
    cachedAt = Date.now();
    return members;
  }

  async function save(members: StaffMember[]): Promise<void> {
    await transport.write(toStaffValues(members));
    cache = members;
    cachedAt = Date.now();
  }

  function change<T>(
    mutate: (members: StaffMember[]) => Promise<T> | T,
  ): Promise<T> {
    const run = queue.then(async () => {
      // Never from cache: granting access must not build on a stale read.
      cache = null;
      return mutate(await load());
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    list: () => load(),

    add(email, role, addedBy) {
      return change(async (members) => {
        const member: StaffMember = {
          email: normalizeEmail(email),
          role,
          addedBy,
          addedAt: new Date().toISOString(),
        };
        // Re-adding an existing address changes their role rather than
        // leaving two rows to disagree about it.
        const without = members.filter((row) => row.email !== member.email);
        await save([...without, member]);
        return member;
      });
    },

    remove(email) {
      return change(async (members) => {
        const target = normalizeEmail(email);
        const left = members.filter((row) => row.email !== target);
        if (left.length === members.length) return false;
        await save(left);
        return true;
      });
    },
  };
}
