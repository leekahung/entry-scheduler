import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeAdminEntry } from "../shared/entry.fixture";
import EraseEntryDialog from "./EraseEntryDialog";

const ADA = makeAdminEntry({
  id: 7,
  name: "Ada Lovelace",
  deletedAt: "2026-09-07T10:00:00.000Z",
});

const show = (entry = ADA) => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <EraseEntryDialog
      entry={entry}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm, view };
};

const typeName = (name: string) =>
  userEvent.type(screen.getByLabelText(/type the name/i), name);

const eraseButton = () =>
  screen.getByRole("button", {
    name: "Erase permanently",
  }) as HTMLButtonElement;

describe("erasing a removed entry for good", () => {
  it("says what erasing does that removing did not", () => {
    show();
    const asked = screen.getByRole("dialog").textContent ?? "";
    expect(asked).toContain("can still be put back");
    expect(asked).toContain("month tab");
    expect(asked).toContain("Nothing brings it back");
  });

  it("erases nothing until the name is typed exactly", async () => {
    const { onConfirm } = show();
    expect(eraseButton().disabled).toBe(true);

    await typeName("Ada");
    expect(eraseButton().disabled).toBe(true);

    await typeName(" Lovelace");
    expect(eraseButton().disabled).toBe(false);
    await userEvent.click(eraseButton());
    // The typed text, not the row's own name: the server compares the two, so
    // sending the name back from the entry would check nothing.
    expect(onConfirm).toHaveBeenCalledWith(ADA, "Ada Lovelace");
  });

  // Or reopening it on the same entry finds the gate already satisfied by a
  // name nobody typed.
  it("forgets a typed name when the question is declined", async () => {
    const { view, onConfirm } = show();
    await typeName("Ada Lovelace");
    await userEvent.click(
      screen.getByRole("button", { name: "Keep the record" }),
    );

    const again = (
      <EraseEntryDialog entry={ADA} onCancel={vi.fn()} onConfirm={onConfirm} />
    );
    view.rerender(
      <EraseEntryDialog
        entry={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    view.rerender(again);

    expect(eraseButton().disabled).toBe(true);
    expect(
      (screen.getByLabelText(/type the name/i) as HTMLInputElement).value,
    ).toBe("");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does nothing when the question is declined", async () => {
    const { onCancel, onConfirm } = show();
    await userEvent.click(
      screen.getByRole("button", { name: "Keep the record" }),
    );
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // A name typed against one person must never stand over the next.
  it("does not carry a typed name to another entry", async () => {
    const { view } = show();
    await typeName("Ada Lovelace");
    expect(eraseButton().disabled).toBe(false);

    view.rerender(
      <EraseEntryDialog
        entry={makeAdminEntry({
          id: 8,
          name: "Grace Hopper",
          deletedAt: "2026-09-07T11:00:00.000Z",
        })}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(eraseButton().disabled).toBe(true);
    expect(
      (screen.getByLabelText(/type the name/i) as HTMLInputElement).value,
    ).toBe("");
  });
});
