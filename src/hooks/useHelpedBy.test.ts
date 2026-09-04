import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_NAME } from "../../server/shared/limits";
import { useHelpedBy } from "./useHelpedBy";

describe("who the console is helping as", () => {
  it("uses the name the Google session carries", () => {
    const { result } = renderHook(() => useHelpedBy("Kim Ng"));
    expect(result.current.signedInAs).toBe("Kim Ng");
    expect(result.current.helpedBy).toBe("Kim Ng");
  });

  // A console is passed from one person to the next; a name left on the device
  // must never sign work to whoever is actually signed in.
  it("lets the signed-in name win over one typed on the device", () => {
    localStorage.setItem("helpedBy", "Sam");
    const { result } = renderHook(() => useHelpedBy("Kim Ng"));
    expect(result.current.helpedBy).toBe("Kim Ng");
  });

  it("falls back to the typed name when the session carries none", () => {
    localStorage.setItem("helpedBy", "Sam");
    const { result } = renderHook(() => useHelpedBy(""));
    expect(result.current.signedInAs).toBe("");
    expect(result.current.helpedBy).toBe("Sam");
  });

  it("starts empty on a device nobody has typed a name into", () => {
    const { result } = renderHook(() => useHelpedBy(""));
    expect(result.current.helpedBy).toBe("");
  });

  it("keeps the typed name on the device for the next reload", () => {
    const { result } = renderHook(() => useHelpedBy(""));
    act(() => result.current.setTypedAs("Sam"));

    expect(result.current.helpedBy).toBe("Sam");
    expect(localStorage.getItem("helpedBy")).toBe("Sam");
  });

  // The server holds this name to the same length as any other, so a longer
  // one would be rejected on every save rather than once here.
  it("clamps a very long signed-in name to what the server accepts", () => {
    const { result } = renderHook(() => useHelpedBy("N".repeat(MAX_NAME + 20)));
    expect(result.current.signedInAs).toHaveLength(MAX_NAME);
  });
});
