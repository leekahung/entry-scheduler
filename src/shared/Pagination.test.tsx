import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Pagination from "./Pagination";

const show = (page: number, pages: number) => {
  const onPage = vi.fn();
  render(
    <Pagination
      page={page}
      pages={pages}
      from={1}
      to={10}
      total={pages * 10}
      onPage={onPage}
      label="Queue pages"
    />,
  );
  return onPage;
};

const clickable = () =>
  screen.getAllByRole("button").map((button) => button.textContent);

describe("the page control", () => {
  // It appearing as a list crossed ten would move everything under it.
  it("stays on screen with both steps closed when it all fits", () => {
    show(1, 1);
    expect(screen.getByRole("navigation")).toBeTruthy();
    for (const name of ["Previous", "Next"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });

  it("says which page is being read, and of how many", () => {
    show(2, 3);
    expect(screen.getByRole("navigation").textContent).toContain("Page 2 of 3");
  });

  // A row of page numbers was numbers nobody pressed: the list is read in
  // order, so the two steps are what anyone reaches for.
  it("offers the two steps and nothing else to click", () => {
    show(2, 40);
    expect(clickable()).toEqual(["Previous", "Next"]);
  });

  it("steps one either way", async () => {
    const onPage = show(2, 3);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  // Both stay on screen: a dimmed step says the end of the list has been
  // reached, where one that vanished would say only that something moved.
  it("closes the step that leads nowhere, on the first page", () => {
    show(1, 3);
    const previous = screen.getByRole("button", { name: "Previous" });
    expect((previous as HTMLButtonElement).disabled).toBe(true);
    expect(previous.className).not.toContain("invisible");

    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("closes the other one on the last page", () => {
    show(3, 3);
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  // However long the list gets, the control stays the same size.
  it("reads the same at forty pages as at three", () => {
    show(10, 40);
    expect(screen.getByRole("navigation").textContent).toContain(
      "Page 10 of 40",
    );
    expect(clickable()).toEqual(["Previous", "Next"]);
  });

  it("names the list it belongs to", () => {
    show(1, 3);
    expect(
      screen.getByRole("navigation", { name: "Queue pages" }),
    ).toBeTruthy();
  });
});
