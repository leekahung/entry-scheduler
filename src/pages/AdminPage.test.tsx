import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "./AdminPage";
import * as api from "../shared/api";
import { makeAdminEntry } from "../shared/entry.fixture";

vi.mock("../shared/api", async (real) => ({
  ...(await real<typeof api>()),
  fetchAuthMode: vi.fn(async () => ({ google: false })),
  verifyPasscode: vi.fn(async () => ({
    accepted: true,
    lockedOut: false,
    remaining: null,
    sheetUrl: null,
  })),
  fetchAllEntries: vi.fn(),
  fetchAdminAlerts: vi.fn(async () => ({
    failedAttempts: 0,
    lastAttemptAt: null,
    windowMinutes: 15,
  })),
  fetchSignedInEmail: vi.fn(async () => null),
}));

// Enough rows to page, so the strip has a control to render. Set here rather
// than in the mock factory, which is hoisted above this file's imports.
const ROWS = Array.from({ length: 34 }, (_, index) =>
  makeAdminEntry({ id: index + 1, name: `P${index + 1}`, status: "new" }),
);

beforeEach(() => vi.mocked(api.fetchAllEntries).mockResolvedValue(ROWS));

describe("crossing the sign-in gate", () => {
  // The console renders behind an early return, so anything hook-shaped has to
  // sit above it: one declared below changes how many hooks this component
  // calls the moment somebody signs in, and React refuses the render.
  it("reaches the queue without changing its hook count", async () => {
    render(<AdminPage />);
    await userEvent.type(await screen.findByLabelText("Passcode"), "pass");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Queue admin" })).toBeTruthy(),
    );
  });
});

describe("the strip above the table", () => {
  const signIn = async () => {
    render(<AdminPage />);
    await userEvent.type(await screen.findByLabelText("Passcode"), "pass");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Queue admin" })).toBeTruthy(),
    );
  };

  it("steps the table through its pages", async () => {
    await signIn();
    const nav = await screen.findByRole("navigation", { name: /pages/i });
    expect(nav.textContent).toContain("Page 1 of 4");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(nav.textContent).toContain("Page 2 of 4");
  });

  // A circular arrow beside Previous and Next would read as one of them, so
  // it follows the tabs at the other end of the strip instead.
  it("keeps the sync with the tabs, not with the page steps", async () => {
    await signIn();
    const nav = await screen.findByRole("navigation", { name: /pages/i });
    const sync = screen.getByRole("button", { name: "Sync this month" });

    expect(nav.contains(sync)).toBe(false);
    expect(sync.parentElement?.contains(screen.getByRole("tablist"))).toBe(
      true,
    );
  });
});
