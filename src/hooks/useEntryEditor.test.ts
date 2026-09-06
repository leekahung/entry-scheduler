import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeAdminEntry } from "../shared/entry.fixture";
import type { EditorDraft } from "../admin/editorDraft";
import { useEntryEditor } from "./useEntryEditor";

describe("opening an entry for editing", () => {
  it("prefills an unclaimed entry with whoever is at the console", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry({ id: 4 }), "Kim"));

    expect(result.current.editing?.id).toBe(4);
    expect(result.current.editing?.draft.helpedBy).toBe("Kim");
  });

  // The editor sends only what differs from `initial`. Seeding the helper
  // into both made it compare equal to itself, so the name staff could see in
  // the field was silently dropped from the save.
  it("keeps the helper out of the copy the save is compared against", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry(), "Kim"));

    expect(result.current.editing?.draft.helpedBy).toBe("Kim");
    expect(result.current.editing?.initial.helpedBy).toBe("");
  });

  it("never writes over a name already recorded", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() =>
      result.current.toggle(makeAdminEntry({ helpedBy: "Sam" }), "Kim"),
    );

    expect(result.current.editing?.draft.helpedBy).toBe("Sam");
    expect(result.current.editing?.initial.helpedBy).toBe("Sam");
  });

  it("closes the row that is already open rather than reopening it", () => {
    const { result } = renderHook(() => useEntryEditor());
    const entry = makeAdminEntry({ id: 7 });

    act(() => result.current.toggle(entry, ""));
    expect(result.current.editing?.id).toBe(7);

    act(() => result.current.toggle(entry, ""));
    expect(result.current.editing).toBeNull();
  });

  // The draft changes on every keystroke; the row it belongs to must not
  // move with it.
  it("keeps the row and the comparison copy while the draft changes", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry({ id: 3 }), "Kim"));

    const edited = { ...result.current.editing?.draft, helpedBy: "Sam" };
    act(() => result.current.setDraft(edited as EditorDraft));

    expect(result.current.editing?.id).toBe(3);
    expect(result.current.editing?.draft.helpedBy).toBe("Sam");
    expect(result.current.editing?.initial.helpedBy).toBe("");
  });

  it("moves to another row without carrying the first one's draft", () => {
    const { result } = renderHook(() => useEntryEditor());
    act(() => result.current.toggle(makeAdminEntry({ id: 1 }), "Kim"));
    act(() =>
      result.current.toggle(makeAdminEntry({ id: 2, helpedBy: "Sam" }), "Kim"),
    );

    expect(result.current.editing?.id).toBe(2);
    expect(result.current.editing?.draft.helpedBy).toBe("Sam");
  });
});
