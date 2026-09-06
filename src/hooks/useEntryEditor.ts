import { useState } from "react";
import type { AdminEntry } from "../shared/types";
import { seedDraft, type EditorDraft } from "../admin/editorDraft";

/** The row being edited, with the drafts that belong to it. */
export type Editing = {
  id: number;
  draft: EditorDraft;
  /** Seeded without the helper, so a prefilled name still counts as a change
      and is saved. Seeding both from the same draft would compare it equal to
      itself and drop the very name the field is showing. */
  initial: EditorDraft;
};

/**
 * The row being edited and its draft.
 * The draft lives out here rather than in the editor: an entry can move
 * between tabs mid-edit (an appointment coming due, another admin changing its
 * status), which unmounts the editor and would take the draft with it.
 */
export function useEntryEditor() {
  const [editing, setEditing] = useState<Editing | null>(null);

  const close = () => setEditing(null);

  /**
   * Opens one row for editing, or closes it if it is the one already open.
   * `helper` prefills an unclaimed entry with whoever is at the console.
   */
  const toggle = (entry: AdminEntry, helper: string) =>
    setEditing((current) =>
      current?.id === entry.id
        ? null
        : {
            id: entry.id,
            draft: seedDraft(entry, helper),
            initial: seedDraft(entry),
          },
    );

  const setDraft = (draft: EditorDraft) =>
    setEditing((current) => (current ? { ...current, draft } : current));

  return { editing, setDraft, toggle, close };
}
