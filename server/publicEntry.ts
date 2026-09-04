import { isDue, type Entry } from "./entry.js";

/**
 * Shortens a name for the shared queue display, so a screen anyone can see
 * (or photograph) shows "Ada L." rather than a full legal name.
 */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const last = parts[parts.length - 1];
  // Iterate by code point: last[0] would split a surrogate pair and render as
  // a replacement glyph for names outside the BMP.
  const initial = [...last][0].toUpperCase();
  return `${parts.slice(0, -1).join(" ")} ${initial}.`;
}

/**
 * Public view of an entry — no admin-only bookkeeping fields, no full name.
 * The triage level stays private: the board is visible to everyone waiting,
 * and labelling who was bumped ahead invites exactly the argument staff don't
 * need. The order itself already reflects it.
 */
export function publicView(entry: Entry, now = Date.now()) {
  return {
    id: entry.id,
    name: publicName(entry.name),
    status: entry.status,
    createdAt: entry.createdAt,
    scheduledFor: entry.scheduledFor,
    // Sent rather than recomputed in the browser: the server already decides
    // the order from this, and a client clock that disagrees would draw a
    // board contradicting the queue it is showing.
    due: isDue(entry, now),
  };
}
