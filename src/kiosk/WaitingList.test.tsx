import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE } from "../hooks/usePaging";
import type { QueueEntry } from "../shared/types";
import WaitingList from "./WaitingList";

const waiting = (count: number): QueueEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `P${index + 1}`,
    status: "new",
    createdAt: "2026-09-07T10:00:00.000Z",
    scheduledFor: "",
    due: true,
  }));

const show = (count: number) =>
  render(<WaitingList waiting={waiting(count)} loaded mineId={undefined} />);

const rows = () => screen.getAllByRole("listitem");

describe("the visitor's view of the line", () => {
  it("shows a short line in full, with nothing to step to", () => {
    show(PAGE_SIZE);
    expect(rows()).toHaveLength(PAGE_SIZE);
    // The control stays put rather than appearing as the line crosses ten,
    // which would move the page under whoever is reading it.
    expect(screen.getByRole("navigation").textContent).toContain("Page 1 of 1");
    for (const name of ["Previous", "Next"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });

  it("splits a long line into pages", async () => {
    show(PAGE_SIZE * 2 + 1);
    expect(rows()).toHaveLength(PAGE_SIZE);
    expect(rows()[0]?.textContent).toContain("P1");
    expect(screen.getByRole("navigation").textContent).toContain("Page 1 of 3");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(rows()[0]?.textContent).toContain(`P${PAGE_SIZE + 1}`);

    // The last page is short and stops there — the spacers keep the card the
    // same height, so only the real rows are counted.
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole("navigation").textContent).toContain("Page 3 of 3");
  });

  it("steps back and forward one page at a time", async () => {
    show(PAGE_SIZE * 2);
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(rows()[0]?.textContent).toContain(`P${PAGE_SIZE + 1}`);
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(rows()[0]?.textContent).toContain("P1");
  });

  // The number in the heading is how many people are in the room, which the
  // page size must not appear to change.
  it("counts the whole line in the heading, not the page", () => {
    show(PAGE_SIZE * 3);
    expect(
      screen.getByRole("heading", {
        name: `Currently waiting (${PAGE_SIZE * 3})`,
      }),
    ).toBeTruthy();
  });

  it("says which of the line is on screen", () => {
    show(PAGE_SIZE + 4);
    expect(screen.getByRole("navigation").textContent).toContain(
      `1–${PAGE_SIZE} of ${PAGE_SIZE + 4}`,
    );
  });

  it("offers visitors no page box to type into", () => {
    show(PAGE_SIZE * 4);
    expect(screen.queryByLabelText("Go to")).toBeNull();
  });

  // The line moves while people are watching it; a card that grew and shrank
  // would take the rest of the screen with it.
  it("stands the same height however many are in the line", () => {
    // Counted off the DOM, not the accessibility tree: the spacers are hidden
    // from the latter on purpose, which is the next test.
    const laidOut = (view: { container: HTMLElement }) =>
      view.container.querySelectorAll("li").length;

    const view = render(
      <WaitingList waiting={waiting(PAGE_SIZE)} loaded mineId={undefined} />,
    );
    expect(laidOut(view)).toBe(PAGE_SIZE);

    view.rerender(
      <WaitingList waiting={waiting(3)} loaded mineId={undefined} />,
    );
    expect(laidOut(view)).toBe(PAGE_SIZE);

    view.rerender(<WaitingList waiting={[]} loaded mineId={undefined} />);
    expect(laidOut(view)).toBe(PAGE_SIZE);
    expect(screen.getByText("Nobody in line right now.")).toBeTruthy();
  });

  it("keeps the spacers out of what a screen reader reads", () => {
    show(3);
    // Ten rows are laid out; only the three real ones are announced.
    expect(document.querySelectorAll("li")).toHaveLength(PAGE_SIZE);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says nothing of a range when nobody is in line", () => {
    show(0);
    expect(screen.getByRole("navigation").textContent).toContain("0 of 0");
  });

  // The counter is wider on some pages than others; anchoring the row to the
  // right keeps the steps still while the text beside them changes.
  it("hangs the control off the right so the steps do not move", () => {
    show(PAGE_SIZE * 3);
    expect(screen.getByRole("navigation").className).toContain("justify-end");
  });
});
