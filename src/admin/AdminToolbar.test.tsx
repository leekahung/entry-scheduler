import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AdminToolbar from "./AdminToolbar";

/** The toolbar with nothing in the room and both exports wired. */
function toolbar(overrides: Partial<Parameters<typeof AdminToolbar>[0]> = {}) {
  const props = {
    entries: [],
    inRoom: 0,
    beingHelped: 0,
    email: "sam@example.org",
    sheetUrl: null,
    showBooking: false,
    onToggleBooking: vi.fn(),
    onExport: vi.fn(),
    onExportWorkbook: vi.fn(),
    owner: true,
    onSignOut: vi.fn(),
    manageStaff: false,
    showStaff: false,
    onToggleStaff: vi.fn(),
    ...overrides,
  };
  render(<AdminToolbar {...props} />);
  return props;
}

describe("the console toolbar", () => {
  it("offers the current list and the whole record as separate downloads", async () => {
    const props = toolbar();

    await userEvent.click(screen.getByRole("button", { name: /all months/i }));
    expect(props.onExportWorkbook).toHaveBeenCalledOnce();
    // The two are different files for different jobs; one must not fire the
    // other.
    expect(props.onExport).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: /current list/i }),
    );
    expect(props.onExport).toHaveBeenCalledOnce();
    expect(props.onExportWorkbook).toHaveBeenCalledOnce();
  });

  it("offers the whole record to owners only", () => {
    toolbar({ owner: false });
    // The board is what staff are already looking at; every month the clinic
    // has ever filed is not.
    expect(screen.queryByRole("button", { name: /all months/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /current list/i }),
    ).not.toBeNull();
  });
});
