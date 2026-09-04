import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeAdminEntry } from "../shared/entry.fixture";
import { useEntryEditor } from "./useEntryEditor";

describe("opening an entry for editing", () => {
  it("prefills an unclaimed entry with whoever is at the console", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry({ id: 4 }), "Kim"));

    expect(result.current.editingId).toBe(4);
    expect(result.current.draft?.helpedBy).toBe("Kim");
  });

  // The editor sends only what differs from `initialDraft`. Seeding the helper
  // into both made it compare equal to itself, so the name staff could see in
  // the field was silently dropped from the save.
  it("keeps the helper out of the copy the save is compared against", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry(), "Kim"));

    expect(result.current.draft?.helpedBy).toBe("Kim");
    expect(result.current.initialDraft?.helpedBy).toBe("");
  });

  it("never writes over a name already recorded", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() =>
      result.current.toggle(makeAdminEntry({ helpedBy: "Sam" }), "Kim"),
    );

    expect(result.current.draft?.helpedBy).toBe("Sam");
    expect(result.current.initialDraft?.helpedBy).toBe("Sam");
  });

  it("closes the row that is already open rather than reopening it", () => {
    const { result } = renderHook(() => useEntryEditor());
    const entry = makeAdminEntry({ id: 7 });

    act(() => result.current.toggle(entry, ""));
    expect(result.current.editingId).toBe(7);

    act(() => result.current.toggle(entry, ""));
    expect(result.current.editingId).toBeNull();
    expect(result.current.draft).toBeNull();
  });

  it("moves to another row without carrying the first one's draft", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry({ id: 1 }), "Kim"));
    act(() =>
      result.current.toggle(makeAdminEntry({ id: 2, helpedBy: "Sam" }), "Kim"),
    );

    expect(result.current.editingId).toBe(2);
    expect(result.current.draft?.helpedBy).toBe("Sam");
  });
});
