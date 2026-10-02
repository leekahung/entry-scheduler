import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchAllEntries, purgeEntry, updateStatus } from "../shared/api";
import { makeAdminEntry } from "../shared/entry.fixture";
import type { AdminEntry } from "../shared/types";
import type { Toasts } from "../shared/toasts";
import { syncedMonths, useEntries } from "./useEntries";

vi.mock("../shared/api", async (actual) => ({
  ...(await actual<typeof import("../shared/api")>()),
  fetchAllEntries: vi.fn(),
  purgeEntry: vi.fn(),
  updateStatus: vi.fn(),
}));

describe("what a sync says it wrote", () => {
  it("names one month", () => {
    expect(syncedMonths(["September 2026"])).toBe("Synced September 2026.");
  });

  it("joins two with and, not a comma", () => {
    expect(syncedMonths(["August 2026", "September 2026"])).toBe(
      "Synced August 2026 and September 2026.",
    );
  });

  it("punctuates three properly", () => {
    expect(syncedMonths(["July 2026", "August 2026", "September 2026"])).toBe(
      "Synced July 2026, August 2026, and September 2026.",
    );
  });

  it("counts them once a list would stop being read", () => {
    const year = Array.from({ length: 12 }, (_, i) => `Month ${i} 2026`);
    // A board that has never been filed spans a year, and twelve tab names in
    // a toast is not a sentence anyone reads.
    expect(syncedMonths(year)).toBe("Synced 12 months.");
  });

  it("says so when there was nothing to write", () => {
    expect(syncedMonths([])).toBe("Nothing to sync — the board is empty.");
  });
});

describe("the console's list", () => {
  // The refresh read the board before the change landed, so letting it win
  // would show the row as it was until the next poll.
  it("keeps a change over a refresh that started before it", async () => {
    const waiting = makeAdminEntry({ status: "new" });
    const helping = { ...waiting, status: "pending" as const };
    let finishSlowRead: (rows: AdminEntry[]) => void = () => {};
    vi.mocked(fetchAllEntries)
      .mockResolvedValueOnce([waiting])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishSlowRead = resolve;
        }),
      );
    vi.mocked(updateStatus).mockResolvedValue(helping);
    const toasts = { track: (_labels, action) => action() } as Toasts;

    const { result } = renderHook(() =>
      useEntries("pass", true, toasts, false),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let slow: Promise<void> = Promise.resolve();
    act(() => {
      slow = result.current.refresh();
    });
    await act(() => result.current.setStatus(waiting, "pending", ""));
    await act(async () => {
      finishSlowRead([waiting]);
      await slow;
    });

    expect(result.current.entries[0]?.status).toBe("pending");
  });

  // Erasing frees the number, so by the time the erase answers, a refresh can
  // already be showing a newcomer under it.
  it("keeps a newcomer who took an erased entry's number", async () => {
    const erased = makeAdminEntry({ id: 12, name: "Spam", deletedAt: "x" });
    const newcomer = makeAdminEntry({
      id: 12,
      name: "Bo",
      createdAt: "2026-10-02T11:00:00.000Z",
    });
    let answerErase: () => void = () => {};
    vi.mocked(fetchAllEntries)
      .mockResolvedValueOnce([erased])
      .mockResolvedValueOnce([newcomer]);
    vi.mocked(purgeEntry).mockReturnValue(
      new Promise<void>((resolve) => {
        answerErase = resolve;
      }),
    );
    const toasts = { track: (_labels, action) => action() } as Toasts;

    const { result } = renderHook(() => useEntries("pass", true, toasts, true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let erasing: Promise<unknown> = Promise.resolve();
    act(() => {
      erasing = result.current.purge(erased, "Spam");
    });
    await act(() => result.current.refresh());
    await act(async () => {
      answerErase();
      await erasing;
    });

    expect(result.current.entries.map((entry) => entry.name)).toEqual(["Bo"]);
  });
});
