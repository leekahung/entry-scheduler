/** Date formatting shared by the console and the queue board. */

/**
 * <input type="datetime-local"> speaks local wall-clock time with no zone, so
 * both directions have to go through the browser's offset rather than slicing
 * the ISO string, which would silently shift the appointment by the offset.
 */
export function toLocalInput(iso: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const offset = at.getTimezoneOffset() * 60_000;
  return new Date(at.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

export function formatAppointment(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function minutesAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

/**
 * How long someone has been waiting, as a compact label plus the raw minutes
 * so the caller can decide when a wait has run long.
 */
export function waitedFor(iso: string): { minutes: number; label: string } {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 1) return { minutes, label: "just now" };
  if (minutes < 60) return { minutes, label: `${minutes}m` };
  const hours = Math.floor(minutes / 60);
  return { minutes, label: `${hours}h ${minutes % 60}m` };
}

/**
 * Today's calendar date in the browser's own zone.
 * `toISOString()` would give the UTC date, which is already tomorrow for
 * anyone far enough east and still yesterday for anyone far enough west.
 */
export function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
