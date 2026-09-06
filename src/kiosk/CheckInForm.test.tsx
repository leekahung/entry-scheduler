import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CheckInForm from "./CheckInForm";

const show = (submitting = false) => {
  const onSubmit = vi.fn();
  render(
    <CheckInForm
      onSubmit={onSubmit}
      onCancel={() => {}}
      submitting={submitting}
    />,
  );
  return onSubmit;
};

const checkIn = () =>
  userEvent.click(screen.getByRole("button", { name: "Check in" }));

describe("what a visitor checks in with", () => {
  // A visitor who never touches the box must not be recorded as a gender
  // they never gave.
  it("opens with no gender chosen", () => {
    show();
    expect((screen.getByLabelText("Gender") as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("sends a blank gender when nobody answered", async () => {
    const onSubmit = show();
    await userEvent.type(screen.getByLabelText(/your name/i), "Ada");
    await checkIn();

    expect(onSubmit).toHaveBeenCalledWith(
      "Ada",
      expect.objectContaining({ gender: "" }),
    );
  });

  it("sends the gender that was chosen", async () => {
    const onSubmit = show();
    await userEvent.type(screen.getByLabelText(/your name/i), "Ada");
    await userEvent.selectOptions(
      screen.getByLabelText("Gender"),
      "Non-binary",
    );
    await checkIn();

    expect(onSubmit).toHaveBeenCalledWith(
      "Ada",
      expect.objectContaining({ gender: "Non-binary" }),
    );
  });

  it("trims the name it sends, so a stray space is not part of it", async () => {
    const onSubmit = show();
    await userEvent.type(screen.getByLabelText(/your name/i), "  Ada  ");
    await checkIn();

    expect(onSubmit).toHaveBeenCalledWith("Ada", expect.anything());
  });

  it("will not check in on a name that is only spaces", async () => {
    const onSubmit = show();
    await userEvent.type(screen.getByLabelText(/your name/i), "   ");
    await checkIn();

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
