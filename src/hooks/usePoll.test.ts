import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePoll } from "./usePoll";

/** Puts the tab on screen or away, the way a browser does. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("polling only while the tab is being read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("polls straight away and then on the interval", () => {
    const poll = vi.fn();
    renderHook(() => usePoll(poll, 5000));

    expect(poll).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("stops while the tab is hidden, so a pocket does not spend the budget", () => {
    const poll = vi.fn();
    renderHook(() => usePoll(poll, 5000));
    poll.mockClear();

    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(poll).not.toHaveBeenCalled();
  });

  it("polls the moment the tab comes back to something that has gone stale", () => {
    const poll = vi.fn();
    renderHook(() => usePoll(poll, 5000));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(5000));
    poll.mockClear();

    act(() => setVisibility("visible"));
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("sits out the rest of the wait when the tab was away for a moment", () => {
    const poll = vi.fn();
    renderHook(() => usePoll(poll, 5000));
    act(() => vi.advanceTimersByTime(1000));
    poll.mockClear();

    // Switching to another tab and back is not a reason to ask again: the
    // board is a second old, and a console flicked between tabs would spend
    // the rate limit a whole waiting room shares.
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(poll).not.toHaveBeenCalled();

    // The wait it was part-way through still runs out on time.
    act(() => vi.advanceTimersByTime(4000));
    expect(poll).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does not poll at all until the caller says there is something to poll for", () => {
    const poll = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => usePoll(poll, 5000, active),
      { initialProps: { active: false } },
    );

    act(() => vi.advanceTimersByTime(60_000));
    expect(poll).not.toHaveBeenCalled();

    rerender({ active: true });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("polls at once when the caller switches back on, whatever the wait held", () => {
    const poll = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => usePoll(poll, 5000, active),
      { initialProps: { active: true } },
    );
    act(() => vi.advanceTimersByTime(1000));
    poll.mockClear();

    // Signing out empties the board, so signing straight back in must not
    // leave it blank for the rest of a wait nobody is watching.
    rerender({ active: false });
    rerender({ active: true });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("keeps the interval running when the caller rebuilds its callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ poll }) => usePoll(poll, 5000), {
      initialProps: { poll: first },
    });

    act(() => vi.advanceTimersByTime(4000));
    rerender({ poll: second });
    // The wait is not restarted, and it is the newest callback that runs.
    act(() => vi.advanceTimersByTime(1000));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1); // only the poll on mount
  });

  it("stops polling once the component is gone", () => {
    const poll = vi.fn();
    const { unmount } = renderHook(() => usePoll(poll, 5000));
    poll.mockClear();

    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(poll).not.toHaveBeenCalled();
  });
});
