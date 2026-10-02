import { isDue, type Entry } from "./entry.js";

/**
 * Shortens a name for the shared queue display, so a screen anyone can see
 * (or photograph) shows "Ada L." rather than a full legal name.
 */
export function publicName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  // Initials after the first name, since a middle name and a first surname look
  // alike. By code point, so a surrogate pair is not split.
  const initials = rest.map((word) => `${[...word][0].toUpperCase()}.`);
  return [first, ...initials].join(" ");
}

/**
 * Public view of an entry: no staff fields, no full name.
 * The visit type stays private, so the room cannot argue over who went first.
 */
export function publicView(entry: Entry, now = Date.now()) {
  return {
    id: entry.id,
    name: publicName(entry.name),
    status: entry.status,
    createdAt: entry.createdAt,
    scheduledFor: entry.scheduledFor,
    // From the server, so a client clock cannot contradict the queue's order.
    due: isDue(entry, now),
  };
}
