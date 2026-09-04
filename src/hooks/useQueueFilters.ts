import { useState } from "react";
import { missingForLog, type AdminEntry, type Priority } from "../shared/types";

/**
 * The console's three filters and the rows they leave.
 * `incompleteCount` is counted off the whole queue, not the filtered view, so
 * the checkbox always says how many entries need details rather than how many
 * the other filters happen to have left.
 */
export function useQueueFilters(entries: AdminEntry[]) {
  const [query, setQuery] = useState("");
  const [triage, setTriage] = useState<Priority | "">("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);

  // Matched against the name and the number, since staff have either one to
  // hand: a name called across the room, or a number on a slip of paper.
  const needle = query.trim().toLowerCase();
  const visible = entries.filter((entry) => {
    if (triage && entry.priority !== triage) return false;
    if (incompleteOnly && missingForLog(entry).length === 0) return false;
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
    incompleteOnly,
    setIncompleteOnly,
    visible,
    filtering: Boolean(needle || triage || incompleteOnly),
    incompleteCount: entries.filter((e) => missingForLog(e).length > 0).length,
    clear: () => {
      setQuery("");
      setTriage("");
      setIncompleteOnly(false);
    },
  };
}
