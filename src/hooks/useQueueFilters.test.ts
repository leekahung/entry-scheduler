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
  makeAdminEntry({ id: 2, name: "Grace Hopper", priority: "urgent" }),
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

  it("narrows to one triage level", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setTriage("urgent"));
    expect(idsOf(result.current.visible)).toEqual([2]);
  });

  it("narrows to the rows still missing log details", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setIncompleteOnly(true));
    expect(idsOf(result.current.visible)).toEqual([2, 3]);
  });

  it("combines the filters rather than replacing one with the next", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setIncompleteOnly(true));
    act(() => result.current.setQuery("Katherine"));
    expect(idsOf(result.current.visible)).toEqual([3]);
  });

  // Counted off the whole queue, so the checkbox always says how many entries
  // need details rather than how many the other filters happen to have left.
  it("counts what needs details across the whole queue, not the filtered view", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    expect(result.current.incompleteCount).toBe(2);
    act(() => result.current.setQuery("Ada"));
    expect(idsOf(result.current.visible)).toEqual([1]);
    expect(result.current.incompleteCount).toBe(2);
  });

  it("puts every filter back at once", () => {
    const { result } = renderHook(() => useQueueFilters(ROWS));
    act(() => result.current.setQuery("Ada"));
    act(() => result.current.setTriage("routine"));
    act(() => result.current.setIncompleteOnly(true));

    act(() => result.current.clear());
    expect(idsOf(result.current.visible)).toEqual([1, 2, 3]);
    expect(result.current.filtering).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.triage).toBe("");
    expect(result.current.incompleteOnly).toBe(false);
  });
});
