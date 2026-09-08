import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserPage from "./UserPage";
import * as api from "../shared/api";

vi.mock("../shared/api", async (real) => ({
  ...(await real<typeof api>()),
  fetchQueue: vi.fn(),
  joinQueue: vi.fn(),
}));

const CREATED_AT = "2026-09-07T10:00:00.000Z";

const mine = (status: string) => ({
  id: 7,
  name: "Ada L.",
  status,
  createdAt: CREATED_AT,
  scheduledFor: "",
  due: true,
});

/** A device already holding ticket #7, as a returning kiosk would be. */
const holdingATicket = () => {
  localStorage.setItem("entryId", "7");
  localStorage.setItem("entryCreatedAt", CREATED_AT);
  localStorage.setItem("entryName", "Ada Lovelace");
};

/** Lets the five-second poll come round with whatever the queue now says. */
const nextPoll = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5100);
  });
};

describe("when staff mark this device's visitor helped", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  const finish = async () => {
    holdingATicket();
    vi.mocked(api.fetchQueue).mockResolvedValue([mine("pending")] as never);
    render(<UserPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("Your ticket")).toBeTruthy(),
    );

    vi.mocked(api.fetchQueue).mockResolvedValue([mine("resolved")] as never);
    await nextPoll();
    await waitFor(() =>
      expect(screen.queryByLabelText("Your ticket")).toBeNull(),
    );
  };

  it("says the visit ended rather than letting the ticket vanish", async () => {
    await finish();
    expect(screen.getByRole("status").textContent).toContain("You’re all set");
  });

  // A shared kiosk shows whatever is on screen to whoever walks up next.
  it("names nobody in the farewell", async () => {
    await finish();
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).not.toContain("Ada");
    expect(said).not.toContain("7");
  });

  // The keys go the moment the entry resolves, which is what stops a staff
  // mis-click back to Waiting drawing the ticket back over the next person.
  it("still clears what the device was holding", async () => {
    await finish();
    expect(localStorage.getItem("entryId")).toBeNull();
    expect(localStorage.getItem("entryCreatedAt")).toBeNull();
  });

  it("holds the farewell until someone taps, then opens the form", async () => {
    await finish();
    await nextPoll();
    expect(screen.getByRole("status").textContent).toContain("You’re all set");

    await userEvent.click(
      screen.getByRole("button", { name: "Check someone else in" }),
    );
    expect(screen.getByLabelText("Your name")).toBeTruthy();
  });

  // It lives in component state alone, so nothing survives to greet the next
  // person with the last one's farewell.
  it("is gone on a reload", async () => {
    await finish();
    vi.mocked(api.fetchQueue).mockResolvedValue([] as never);

    localStorage.clear();
    render(<UserPage />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Check in" }).length).toBe(
        1,
      ),
    );
  });
});
