import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { failureMessage, ToastList, useToasts } from "./toasts";

describe("useToasts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing while a fast operation runs", async () => {
    const { result } = renderHook(() => useToasts());

    await act(async () => {
      await result.current.track(
        { pending: "Saving…", success: "Saved.", failure: "No." },
        async () => {},
      );
    });

    // The pending toast never appeared: a "Saving…" that flashes for a moment
    // reads as a glitch.
    expect(result.current.toasts.map((t) => t.message)).toEqual(["Saved."]);
  });

  it("says what it is doing once an operation is slow enough to notice", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());

    let finish = () => {};
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let tracked: Promise<boolean> = Promise.resolve(false);
    act(() => {
      tracked = result.current.track(
        { pending: "Saving…", success: "Saved.", failure: "No." },
        () => running,
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.toasts.map((t) => t.tone)).toEqual(["pending"]);

    await act(async () => {
      finish();
      await tracked;
    });
    // The pending toast is replaced, not stacked on top of.
    expect(result.current.toasts.map((t) => t.message)).toEqual(["Saved."]);
  });

  it("clears a success sooner than a failure, and both by themselves", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());

    await act(async () => {
      await result.current.track(
        { pending: "…", success: "Saved.", failure: "No." },
        async () => {},
      );
      await result.current.track(
        { pending: "…", success: "Saved.", failure: "Could not save." },
        async () => {
          throw new Error("");
        },
      );
    });
    expect(result.current.toasts).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    // The failure outlives the success: more to read, and more easily missed.
    expect(result.current.toasts.map((t) => t.tone)).toEqual(["error"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("shows the message the status mapping chose", async () => {
    const { result } = renderHook(() => useToasts());

    await act(async () => {
      await result.current.track(
        { pending: "…", success: "Saved.", failure: "Could not save." },
        async () => {
          throw new ApiError("Only an owner can do that.", 403);
        },
      );
    });

    expect(result.current.toasts[0].message).toBe("Only an owner can do that.");
  });

  it("builds a success out of what the operation returned", async () => {
    const { result } = renderHook(() => useToasts());

    await act(async () => {
      await result.current.track(
        {
          pending: "…",
          success: (id: number) => `You are #${id}.`,
          failure: "No.",
        },
        async () => 12,
      );
    });

    expect(result.current.toasts[0].message).toBe("You are #12.");
  });

  it("still calls a success a success when the sentence cannot be built", async () => {
    const { result } = renderHook(() => useToasts());

    await act(async () => {
      await expect(
        result.current.track(
          {
            pending: "\u2026",
            // Stands in for `Intl.ListFormat` on a browser that lacks it.
            success: () => {
              throw new TypeError("not a constructor");
            },
            failure: "The server couldn't do that. Nothing was changed.",
          },
          async () => 12,
        ),
      ).resolves.toBe(true);
    });

    expect(result.current.toasts[0].tone).toBe("success");
  });

  it("reports whether the operation landed", async () => {
    const { result } = renderHook(() => useToasts());
    const labels = { pending: "…", success: "ok", failure: "no" };

    await act(async () => {
      await expect(result.current.track(labels, async () => {})).resolves.toBe(
        true,
      );
      await expect(
        result.current.track(labels, async () => {
          throw new Error("nope");
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("the toast list", () => {
  it("puts a failure in the assertive region and the rest in the polite one", () => {
    render(
      <ToastList
        toasts={[
          { id: 1, tone: "success", message: "Saved." },
          { id: 2, tone: "error", message: "Could not save." },
        ]}
        onDismiss={() => {}}
      />,
    );

    const assertive = document.querySelector('[aria-live="assertive"]');
    const polite = document.querySelector('[aria-live="polite"]');
    expect(assertive?.textContent).toContain("Could not save.");
    expect(polite?.textContent).toContain("Saved.");
  });

  it("can be dismissed, except while the work is still running", async () => {
    const onDismiss = vi.fn();
    render(
      <ToastList
        toasts={[
          { id: 1, tone: "pending", message: "Saving…" },
          { id: 2, tone: "error", message: "Could not save." },
        ]}
        onDismiss={onDismiss}
      />,
    );

    // One button, not two: a pending toast goes when its work does.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});

describe("what a failure is called", () => {
  const copy = {
    fallback: "The server couldn't save that.",
    gone: "#12 is no longer on the board.",
  };

  it("repeats the server where the server was specific", () => {
    expect(failureMessage(new ApiError("Name is required.", 400), copy)).toBe(
      "Name is required.",
    );
    expect(
      failureMessage(new ApiError("Only an owner can do that.", 403), copy),
    ).toBe("Only an owner can do that.");
    expect(failureMessage(new ApiError("Too many attempts.", 429), copy)).toBe(
      "Too many attempts.",
    );
    expect(
      failureMessage(new ApiError("Needs Google sign-in.", 501), copy),
    ).toBe("Needs Google sign-in.");
  });

  it("speaks for itself on a 500, whose body says nothing", () => {
    // The server answers every 500 with "Something went wrong.", which tells
    // nobody anything they did not already know.
    expect(
      failureMessage(new ApiError("Something went wrong.", 500), copy),
    ).toBe("The server couldn't save that.");
  });

  it("explains a 404 as the race it usually is", () => {
    expect(failureMessage(new ApiError("Entry not found.", 404), copy)).toBe(
      "#12 is no longer on the board.",
    );
  });

  it("falls back on a 404 nothing has words for", () => {
    expect(
      failureMessage(new ApiError("Entry not found.", 404), {
        fallback: "No.",
      }),
    ).toBe("No.");
  });

  it("says the session ended on a 401, whatever the route called it", () => {
    // The route says "Admin passcode required", which reads as nonsense to
    // someone who has been signed in and working for an hour.
    expect(
      failureMessage(new ApiError("Admin passcode required.", 401), copy),
    ).toBe("Your session has ended. Sign in again.");
  });

  it("knows a request that never arrived from one that was refused", () => {
    // fetch itself rejecting means nothing reached the server, so nothing can
    // have been written.
    expect(failureMessage(new TypeError("Failed to fetch"), copy)).toBe(
      "Can't reach the server. Nothing was saved.",
    );
    expect(
      failureMessage(new TypeError("Failed to fetch"), {
        fallback: "No.",
        offline: "Ask a member of staff.",
      }),
    ).toBe("Ask a member of staff.");
  });

  it("takes a plain string as the everything-else case", () => {
    expect(failureMessage(new ApiError("boom", 500), "Could not save.")).toBe(
      "Could not save.",
    );
  });
});
