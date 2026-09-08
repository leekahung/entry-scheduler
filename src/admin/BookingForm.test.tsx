import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BookingForm from "./BookingForm";

const submit = () => vi.fn(async () => true);
const addToQueue = () =>
  userEvent.click(screen.getByRole("button", { name: "Add to queue" }));

describe("BookingForm", () => {
  it("books someone in as a walk-in, with whoever will see them", async () => {
    const onSubmit = submit();
    render(<BookingForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText("Client name"), "Ada");
    await userEvent.type(screen.getByLabelText("Helped by"), "Kim");
    await addToQueue();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ada",
        helpedBy: "Kim",
        visitType: "in-person",
      }),
    );
  });

  it("defaults the visit type to walk-in/appointment", () => {
    render(<BookingForm onSubmit={submit()} onCancel={() => {}} />);
    const select = screen.getByLabelText("Visit type") as HTMLSelectElement;

    expect(select.value).toBe("in-person");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Walk-in/Appointment",
      "Email/Phone/Remote",
    ]);
  });

  it("sends the chosen visit type", async () => {
    const onSubmit = submit();
    render(<BookingForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText("Client name"), "Grace");
    await userEvent.selectOptions(
      screen.getByLabelText("Visit type"),
      "remote",
    );
    await addToQueue();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ visitType: "remote", helpedBy: "" }),
    );
  });
});
