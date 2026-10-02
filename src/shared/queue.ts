import type { QueueEntry } from "./types";

type Placed = Pick<QueueEntry, "status" | "due">;

/** In the line now: not finished, and due, as the server decides. */
export const isInRoom = (entry: Placed) =>
  entry.status !== "resolved" && entry.due;

/** Booked for later: not finished, and not due yet. */
export const isScheduledLater = (entry: Placed) =>
  entry.status !== "resolved" && !entry.due;
