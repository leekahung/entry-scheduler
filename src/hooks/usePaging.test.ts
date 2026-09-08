import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, usePaging } from "./usePaging";

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => index + 1);

describe("reading a list a page at a time", () => {
  it("is one page while the list fits in one", () => {
    const { result } = renderHook(() => usePaging(rows(PAGE_SIZE)));
    expect(result.current.pages).toBe(1);
    expect(result.current.rows).toHaveLength(PAGE_SIZE);
    expect(result.current.from).toBe(1);
    expect(result.current.to).toBe(PAGE_SIZE);
  });

  it("splits a longer list and hands out the page asked for", () => {
    const { result } = renderHook(() => usePaging(rows(PAGE_SIZE * 2 + 3)));
    expect(result.current.pages).toBe(3);
    expect(result.current.rows[0]).toBe(1);

    act(() => result.current.setPage(2));
    expect(result.current.rows[0]).toBe(PAGE_SIZE + 1);
    expect(result.current.from).toBe(PAGE_SIZE + 1);
    expect(result.current.to).toBe(PAGE_SIZE * 2);

    // The last page is short, and says so rather than running past the end.
    act(() => result.current.setPage(3));
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.to).toBe(PAGE_SIZE * 2 + 3);
  });

  it("counts an empty list as one page holding nothing", () => {
    const { result } = renderHook(() => usePaging(rows(0)));
    expect(result.current.pages).toBe(1);
    expect(result.current.from).toBe(0);
    expect(result.current.to).toBe(0);
  });

  // The rows underneath refresh on every poll, so the page somebody is on can
  // stop existing while they are reading it.
  it("falls back to the last page when the list shrinks under it", () => {
    const { result, rerender } = renderHook(({ all }) => usePaging(all), {
      initialProps: { all: rows(PAGE_SIZE * 3) },
    });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    rerender({ all: rows(PAGE_SIZE) });
    expect(result.current.page).toBe(1);
    expect(result.current.rows).toHaveLength(PAGE_SIZE);
  });

  it("starts over when told the list is a different one", () => {
    const { result } = renderHook(() => usePaging(rows(PAGE_SIZE * 3)));
    act(() => result.current.setPage(3));
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
  });
});
