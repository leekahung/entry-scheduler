import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

const ask = (open: boolean, onCancel = vi.fn(), onConfirm = vi.fn()) => ({
  onCancel,
  onConfirm,
  ...render(
    <ConfirmDialog
      open={open}
      title="Remove access?"
      body="They lose the console."
      confirmLabel="Remove access"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  ),
});

const dialog = () => screen.getByRole("dialog", { hidden: true });

describe("a question that has to be answered", () => {
  it("opens as a modal, so the page behind it cannot be used", () => {
    ask(true);
    expect((dialog() as HTMLDialogElement).open).toBe(true);
  });

  // A dialog left open would sit over the board with nothing left to answer.
  it("closes again once the answer is no longer needed", () => {
    const { rerender } = ask(true);
    rerender(
      <ConfirmDialog
        open={false}
        title="Remove access?"
        body="They lose the console."
        confirmLabel="Remove access"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect((dialog() as HTMLDialogElement).open).toBe(false);
  });

  it("stays shut until it is asked to open", () => {
    ask(false);
    expect((dialog() as HTMLDialogElement).open).toBe(false);
  });

  it("goes through with it only on the confirming button", async () => {
    const { onConfirm, onCancel } = ask(true);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove access" }),
    );

    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
