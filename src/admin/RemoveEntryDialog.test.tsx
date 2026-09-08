import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdminEntry } from "../shared/types";
import { makeAdminEntry } from "../shared/entry.fixture";
import RemoveEntryDialog from "./RemoveEntryDialog";

const ADA = makeAdminEntry({ id: 7, name: "Ada Lovelace" });

const show = (entry: AdminEntry | null = ADA) => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <RemoveEntryDialog
      entry={entry}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm, view };
};

const click = (name: string) =>
  userEvent.click(screen.getByRole("button", { name }));

describe("confirming an entry is removed", () => {
  // Removal is reversible now, so the question is about where the entry goes
  // rather than about losing it.
  it("names the person and says the entry is kept", () => {
    show();
    const asked = screen.getByRole("dialog").textContent ?? "";

    expect(asked).toContain("Remove #7?");
    expect(asked).toContain("Ada Lovelace");
    expect(asked).toContain("Removed");
    expect(asked).toContain("put back");
  });

  it("asks nothing when no entry is waiting on an answer", () => {
    show(null);
    expect(screen.queryByText(/put back/i)).toBeNull();
  });

  it("removes nothing while the question is still on screen", () => {
    const { onConfirm } = show();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does nothing when the question is declined", async () => {
    const { onCancel, onConfirm } = show();
    await click("Cancel");

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("removes the entry it asked about once confirmed", async () => {
    const { onConfirm } = show();
    await click("Remove entry");

    expect(onConfirm).toHaveBeenCalledWith(ADA);
  });

  // Esc closes a <dialog> without touching either button; that is a decline.
  it("treats dismissing the dialog as a decline", () => {
    const { onCancel } = show();
    (screen.getByRole("dialog") as HTMLDialogElement).close();

    expect(onCancel).toHaveBeenCalled();
  });
});
