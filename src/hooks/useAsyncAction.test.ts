import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../shared/api";
import { useAsyncAction } from "./useAsyncAction";

const failing = (error: unknown) => () => Promise.reject(error);

async function errorFor(error: unknown) {
  const { result } = renderHook(() =>
    useAsyncAction({
      fallback: "That did not work.",
      gone: "That address is no longer on the list.",
    }),
  );
  await act(() => result.current.run(failing(error)));
  return result.current.error;
}

// The same wording the console's toasts use, not whatever the error carries.
describe("what a failed action says", () => {
  it("says the server could not be reached, not the browser's own text", async () => {
    expect(await errorFor(new TypeError("Failed to fetch"))).toBe(
      "Can't reach the server. Nothing was saved.",
    );
  });

  it("says the session ended on a 401", async () => {
    expect(
      await errorFor(new ApiError("Sign in with Google to continue.", 401)),
    ).toBe("Your session has ended. Sign in again.");
  });

  it("passes on what the server named precisely", async () => {
    expect(
      await errorFor(new ApiError("That is not a valid email address.", 400)),
    ).toBe("That is not a valid email address.");
  });

  it("says when what it acted on is already gone", async () => {
    expect(
      await errorFor(new ApiError("That address is not on the list.", 404)),
    ).toBe("That address is no longer on the list.");
  });

  it("falls back to its own words when the server broke", async () => {
    expect(await errorFor(new ApiError("Something went wrong.", 500))).toBe(
      "That did not work.",
    );
  });
});
