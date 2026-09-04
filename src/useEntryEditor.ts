import { useState } from "react";
import type { AdminEntry } from "./api";
import { seedDraft, type EditorDraft } from "./EntryEditor";

/**
 * The row being edited and its draft.
 * The draft lives out here rather than in the editor: an entry can move
 * between tabs mid-edit (an appointment coming due, another admin changing its
 * status), which unmounts the editor and would take the draft with it.
 */
export function useEntryEditor() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [initialDraft, setInitialDraft] = useState<EditorDraft | null>(null);

  const close = () => {
    setEditingId(null);
    setDraft(null);
    setInitialDraft(null);
  };

  /**
   * Opens one row for editing, or closes it if it is the one already open.
   * `helper` prefills an unclaimed entry with whoever is at the console.
   */
  const toggle = (entry: AdminEntry, helper: string) => {
    if (editingId === entry.id) {
      close();
      return;
    }
    setEditingId(entry.id);
    setDraft(seedDraft(entry, helper));
    // Seeded without the helper, so a prefilled name still counts as a change
    // and is saved. Seeding both from the same draft would compare it equal to
    // itself and drop the very name the field is showing.
    setInitialDraft(seedDraft(entry));
  };

  return { editingId, draft, initialDraft, setDraft, toggle, close };
}
