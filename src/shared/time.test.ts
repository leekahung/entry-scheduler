import { describe, expect, it } from "vitest";
import { unclosedMonth } from "./time";

/** An ISO timestamp `months` whole months before now, mid-month and midday. */
function monthsAgo(months: number): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth() - months,
    15,
    12,
    0,
    0,
  ).toISOString();
}

describe("unclosedMonth", () => {
  it("is empty while everything is from the current month", () => {
    expect(unclosedMonth([])).toBe("");
    expect(unclosedMonth([monthsAgo(0), monthsAgo(0)])).toBe("");
  });

  it("names a month once its entries are still on the board", () => {
    expect(unclosedMonth([monthsAgo(1), monthsAgo(0)])).not.toBe("");
  });

  it("names the earliest month, not the most recent one", () => {
    const label = unclosedMonth([monthsAgo(1), monthsAgo(3), monthsAgo(0)]);
    const expected = new Date(
      new Date().getFullYear(),
      new Date().getMonth() - 3,
      15,
    ).toLocaleString([], { month: "long", year: "numeric" });
    expect(label).toBe(expected);
  });
});
