import { useState } from "react";
import type { AdminEntry, VisitType } from "../shared/types";

/** The console's two filters and the rows they leave. */
export function useQueueFilters(entries: AdminEntry[]) {
  const [query, setQuery] = useState("");
  const [visitType, setVisitType] = useState<VisitType | "">("");

  // Matched against the name and the number, since staff have either one to
  // hand: a name called across the room, or a number on a slip of paper.
  const needle = query.trim().toLowerCase();
  const visible = entries.filter((entry) => {
    if (visitType && entry.visitType !== visitType) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      String(entry.id).includes(needle.replace("#", ""))
    );
  });

  return {
    query,
    setQuery,
    visitType,
    setVisitType,
    visible,
    filtering: Boolean(needle || visitType),
    clear: () => {
      setQuery("");
      setVisitType("");
    },
  };
}
