import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeAdminEntry } from "../shared/entry.fixture";
import { seedDraft } from "./editorDraft";
import type { Editing } from "../hooks/useEntryEditor";
import QueueTable from "./QueueTable";

const ADA = makeAdminEntry({ id: 1, name: "Ada" });
const BO = makeAdminEntry({ id: 2, name: "Bo" });

const openOn = (id: number): Editing => {
  const entry = id === ADA.id ? ADA : BO;
  return { id, draft: seedDraft(entry, ""), initial: seedDraft(entry) };
};

const show = (editing: Editing | null) =>
  render(
    <QueueTable
      rows={[ADA, BO]}
      caption="Waiting"
      empty="Nobody is waiting."
      editing={editing}
      onDraftChange={() => {}}
      onToggleEdit={() => {}}
      onStatus={() => {}}
      onPriority={() => {}}
      onSave={vi.fn(async () => true)}
      onRemove={() => {}}
    />,
  );

// One editor at a time: a second would offer to save a draft against the
// wrong row.
describe("which row is open for editing", () => {
  it("shows no editor while nothing is being edited", () => {
    show(null);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("shows the editor on the row being edited, and only there", () => {
    show(openOn(ADA.id));

    expect(
      screen.getAllByRole("button", { name: "Save changes" }),
    ).toHaveLength(1);
    const expanded = screen
      .getAllByRole("button", { name: /Close|Edit/ })
      .filter((button) => button.getAttribute("aria-expanded") === "true");
    expect(expanded).toHaveLength(1);
    expect(expanded[0].textContent).toBe("Close");
  });

  it("follows the open row when a different one is edited", () => {
    const { rerender } = show(openOn(ADA.id));
    rerender(
      <QueueTable
        rows={[ADA, BO]}
        caption="Waiting"
        empty="Nobody is waiting."
        editing={openOn(BO.id)}
        onDraftChange={() => {}}
        onToggleEdit={() => {}}
        onStatus={() => {}}
        onPriority={() => {}}
        onSave={vi.fn(async () => true)}
        onRemove={() => {}}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "Save changes" }),
    ).toHaveLength(1);
  });
});
