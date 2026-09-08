import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdminEntry } from "../shared/types";
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

const show = (editing: Editing | null, rows: AdminEntry[] = [ADA, BO]) =>
  render(
    <QueueTable
      rows={rows}
      caption="Waiting"
      empty="Nobody is waiting."
      editing={editing}
      onDraftChange={() => {}}
      onToggleEdit={() => {}}
      onStatus={() => {}}
      onPriority={() => {}}
      onSave={vi.fn(async () => true)}
      onRemove={() => {}}
      onRestore={() => {}}
      onErase={() => {}}
      owner={false}
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

  // A removed row has no Edit button to close the editor with, and none of the
  // queue's actions apply to it. Reachable when somebody else removes the row
  // that is open here.
  it("shows no editor on a row that has been removed", () => {
    const gone = makeAdminEntry({
      id: ADA.id,
      name: "Ada",
      deletedAt: "2026-09-07T10:00:00.000Z",
    });
    show(openOn(ADA.id), [gone, BO]);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
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
        onRestore={() => {}}
        onErase={() => {}}
        owner={false}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "Save changes" }),
    ).toHaveLength(1);
  });
});

// The status is one control, so putting a row back where it belongs is the
// same act as moving it — not a second button sitting beside the first.
describe("moving a row between states", () => {
  const rowsWith = (...rows: AdminEntry[]) => {
    const onStatus = vi.fn();
    render(
      <QueueTable
        rows={rows}
        caption="Queue"
        empty="Nobody here."
        editing={null}
        onDraftChange={() => {}}
        onToggleEdit={() => {}}
        onStatus={onStatus}
        onPriority={() => {}}
        onSave={vi.fn(async () => true)}
        onRemove={() => {}}
        onRestore={() => {}}
        onErase={() => {}}
        owner={false}
      />,
    );
    return onStatus;
  };

  it("shows where each row is now", () => {
    rowsWith(
      makeAdminEntry({ id: 1, name: "Ada", status: "new" }),
      makeAdminEntry({ id: 2, name: "Bo", status: "pending" }),
      makeAdminEntry({ id: 3, name: "Cy", status: "resolved" }),
    );
    expect(
      (screen.getByLabelText("Status for Ada") as HTMLSelectElement).value,
    ).toBe("new");
    expect(
      (screen.getByLabelText("Status for Bo") as HTMLSelectElement).value,
    ).toBe("pending");
    expect(
      (screen.getByLabelText("Status for Cy") as HTMLSelectElement).value,
    ).toBe("resolved");
  });

  it("offers every state from any row, in one step", async () => {
    const helping = makeAdminEntry({ id: 3, name: "Cy", status: "pending" });
    const onStatus = rowsWith(helping);
    const select = screen.getByLabelText("Status for Cy");

    expect(
      [...(select as HTMLSelectElement).options].map((o) => o.text),
    ).toEqual(["Waiting", "Being helped", "Done"]);

    // The correction a cycling button could only reach by way of Done, which
    // marked someone helped who was never seen.
    await userEvent.selectOptions(select, "new");
    expect(onStatus).toHaveBeenCalledWith(helping, "new");
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it("starts a row being helped", async () => {
    const waiting = makeAdminEntry({ id: 1, name: "Ada", status: "new" });
    const onStatus = rowsWith(waiting);
    await userEvent.selectOptions(
      screen.getByLabelText("Status for Ada"),
      "pending",
    );
    expect(onStatus).toHaveBeenCalledWith(waiting, "pending");
  });
});

// A removed row is not part of the queue, so the queue's actions do not apply
// to it — and putting it back is the whole reason it is still listed.
describe("a row that has been removed", () => {
  const GONE = makeAdminEntry({
    id: 4,
    name: "Di",
    deletedAt: "2026-09-07T10:00:00.000Z",
  });

  const showRemoved = (owner: boolean) => {
    const onRestore = vi.fn();
    const onErase = vi.fn();
    const onStatus = vi.fn();
    render(
      <QueueTable
        rows={[GONE]}
        caption="Removed"
        empty="Nothing has been removed."
        editing={null}
        onDraftChange={() => {}}
        onToggleEdit={() => {}}
        onStatus={onStatus}
        onPriority={() => {}}
        onSave={vi.fn(async () => true)}
        onRemove={() => {}}
        onRestore={onRestore}
        onErase={onErase}
        owner={owner}
      />,
    );
    return { onRestore, onErase, onStatus };
  };

  it("offers to put it back instead of working it", () => {
    showRemoved(false);
    expect(screen.queryByLabelText("Status for Di")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("button", { name: "Put back" })).toBeTruthy();
  });

  it("puts back the row it was asked about", async () => {
    const { onRestore } = showRemoved(false);
    await userEvent.click(screen.getByRole("button", { name: "Put back" }));
    expect(onRestore).toHaveBeenCalledWith(GONE);
  });

  it("offers the erase to owners only", async () => {
    showRemoved(false);
    expect(screen.queryByRole("button", { name: "Erase" })).toBeNull();

    const { onErase } = showRemoved(true);
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    expect(onErase).toHaveBeenCalledWith(GONE);
  });

  it("does not offer to retriage something off the board", () => {
    showRemoved(false);
    const triage = screen.getByLabelText("Triage level for Di");
    expect((triage as HTMLSelectElement).disabled).toBe(true);
  });
});
