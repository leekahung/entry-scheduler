import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeAdminEntry } from "../shared/entry.fixture";
import { useQueueFilters } from "./useQueueFilters";

// Ada is the only complete row; the other two are missing log details.
const ROWS = [
  makeAdminEntry({
    id: 1,
    name: "Ada Lovelace",
    caseType: "Criminal",
    appointmentType: "Consult",
    appointmentOutcome: "Completed",
    timeSpent: 0.5,
  }),
  makeAdminEntry({ id: 2, name: "Grace Hopper", visitType: "remote" }),
  makeAdminEntry({ id: 3, name: "Katherine Johnson" }),
];

const idsOf = (rows: ReturnType<typeof makeAdminEntry>[]) =>
  rows.map((row) => row.id);

describe("filtering the queue", () => {
  it("shows everything and reports no filter until one is set", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    expect(idsOf(result.current.visible)).toEqual([1, 2, 3]);
    expect(result.current.filtering).toBe(false);
  });

  it("matches a name regardless of case", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setQuery("ADA"));
    expect(idsOf(result.current.visible)).toEqual([1]);
    expect(result.current.filtering).toBe(true);
  });

  // Staff have either one to hand: a name called across the room, or a number
  // on a slip of paper.
  it("matches an entry number, with or without the hash", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setQuery("3"));
    expect(idsOf(result.current.visible)).toEqual([3]);
    act(() => result.current.setQuery("#2"));
    expect(idsOf(result.current.visible)).toEqual([2]);
  });

  it("ignores surrounding whitespace in the search", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setQuery("   "));
    expect(idsOf(result.current.visible)).toEqual([1, 2, 3]);
    expect(result.current.filtering).toBe(false);
  });

  it("narrows to one visit type", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setVisitType("remote"));
    expect(idsOf(result.current.visible)).toEqual([2]);
  });

  it("combines the filters rather than replacing one with the next", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setVisitType("remote"));
    act(() => result.current.setQuery("Grace"));
    expect(idsOf(result.current.visible)).toEqual([2]);
  });

  it("puts every filter back at once", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setQuery("Ada"));
    act(() => result.current.setVisitType("in-person"));

    act(() => result.current.clear());
    expect(idsOf(result.current.visible)).toEqual([1, 2, 3]);
    expect(result.current.filtering).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.visitType).toBe("");
  });
});
