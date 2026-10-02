/**
 * An entry's status and visit type, as the server checks them.
 * Shared with the console, so its dropdowns cannot offer a value the server
 * rejects or miss one it accepts.
 */
export const STATUSES = ["new", "pending", "resolved"] as const;
export type Status = (typeof STATUSES)[number];

/** How the clinic is meeting someone: in the room, or at a distance. */
export const VISIT_TYPES = ["in-person", "remote"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];
