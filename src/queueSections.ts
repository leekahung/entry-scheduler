import type { AdminEntry } from "./api";

export type QueueSection = {
  id: string;
  label: string;
  rows: AdminEntry[];
  caption: string;
  /** Shown in place of the rows when the tab is empty. */
  empty: string;
};

/**
 * The queue split into the four tabs, in tab order.
 * Rows come from the filtered view, so a filter tells staff where its matches
 * are rather than emptying the tab they are looking at — which is also why
 * each empty message says whether a filter is the reason.
 */
export function queueSections(
  visible: AdminEntry[],
  total: number,
  filtering: boolean,
): QueueSection[] {
  // `due` comes from the server, which also decides the order, so the split can
  // never disagree with the queue it is describing.
  const inRoom = visible.filter((e) => e.status !== "resolved" && e.due);
  return [
    {
      id: "waiting",
      label: "Waiting",
      // The line splits again by what staff are doing with it: someone already
      // being helped is not part of the queue anyone is waiting in.
      rows: inRoom.filter((e) => e.status === "new"),
      caption: "Walk-ins and appointments that are due, in queue order",
      empty: filtering
        ? "Nobody waiting matches these filters."
        : total === 0
          ? "No entries yet."
          : "Nobody is waiting — everyone has been helped.",
    },
    {
      id: "helping",
      label: "Being helped",
      rows: inRoom.filter((e) => e.status === "pending"),
      caption: "Entries a staff member is helping right now",
      empty: filtering
        ? "Nobody being helped matches these filters."
        : "Nobody is being helped right now.",
    },
    {
      id: "later",
      label: "Scheduled later",
      rows: visible.filter((e) => e.status !== "resolved" && !e.due),
      caption: "Appointments that are not due yet",
      empty: filtering
        ? "No later appointment matches these filters."
        : "Nothing booked for later.",
    },
    {
      id: "done",
      label: "Done",
      rows: visible.filter((e) => e.status === "resolved"),
      caption: "Entries already helped",
      empty: filtering
        ? "Nothing already helped matches these filters."
        : "Nobody has been helped yet.",
    },
  ];
}
