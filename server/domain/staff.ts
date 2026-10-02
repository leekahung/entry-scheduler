import { createSheetCache } from "../sheet/sheetCache.js";
import type { SheetTransport } from "../sheet/store.js";
import { isEmailish, normalizeEmail } from "../shared/email.js";

/** Owners may change who has access; staff may only work the queue. */
const ROLES = ["owner", "staff"] as const;
export type Role = (typeof ROLES)[number];

/** Who a request is, once the session and the staff list agree on it. */
export type Who = { email: string; role: Role };

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
 * cannot grant anyone access, and an address appears at most once.
 */
export function fromStaffValues(values: (string | number)[][]): StaffMember[] {
  const [header, ...rows] = values;
  if (!header) return [];

  const at = (row: (string | number)[], name: string) => {
    const index = header.findIndex((cell) => String(cell) === name);
    return index === -1 ? "" : String(row[index] ?? "");
  };

  // Keyed by address, since a hand edit can repeat one; the lower, later row
  // supplies the details.
  const members = new Map<string, StaffMember>();
  for (const row of rows) {
    const email = normalizeEmail(at(row, "email"));
    if (!isEmailish(email)) continue;
    const role = at(row, "role");
    const seen = members.get(email);
    members.set(email, {
      email,
      // An unreadable or disputed role falls to staff: "owner" must be said by
      // every row naming them.
      role: isRole(role) && seen?.role !== "staff" ? role : "staff",
      addedBy: at(row, "addedBy"),
      addedAt: at(row, "addedAt"),
    });
  }
  return [...members.values()];
}

export type StaffStore = {
  list(): Promise<StaffMember[]>;
  add(email: string, role: Role, addedBy: string): Promise<StaffMember>;
  remove(email: string): Promise<boolean>;
};

/**
 * Who may use the console, kept in its own tab.
 * Cached since every admin request reads it; writes are queued.
 */
export function createStaffStore(transport: SheetTransport): StaffStore {
  const { load, save, queued } = createSheetCache(
    async () => fromStaffValues(await transport.read()),
    (members: StaffMember[]) => transport.write(toStaffValues(members)),
    STAFF_CACHE_MS,
  );

  return {
    list: () => load(),

    add(email, role, addedBy) {
      return queued(async (members) => {
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
      return queued(async (members) => {
        const target = normalizeEmail(email);
        const left = members.filter((row) => row.email !== target);
        if (left.length === members.length) return false;
        await save(left);
        return true;
      });
    },
  };
}
