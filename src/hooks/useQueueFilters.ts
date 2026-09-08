import { useState } from "react";
import type { AdminEntry, Priority } from "../shared/types";

/** The console's two filters and the rows they leave. */
export function useQueueFilters(entries: AdminEntry[]) {
  const [query, setQuery] = useState("");
  const [triage, setTriage] = useState<Priority | "">("");

  // Matched against the name and the number, since staff have either one to
  // hand: a name called across the room, or a number on a slip of paper.
  const needle = query.trim().toLowerCase();
  const visible = entries.filter((entry) => {
    if (triage && entry.priority !== triage) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      String(entry.id).includes(needle.replace("#", ""))
    );
  });

  return {
    query,
    setQuery,
    triage,
    setTriage,
    visible,
    filtering: Boolean(needle || triage),
    clear: () => {
      setQuery("");
      setTriage("");
    },
  };
}
