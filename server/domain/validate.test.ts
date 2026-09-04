import { describe, expect, it, vi } from "vitest";
import { isDob, normalizeScheduledFor } from "./validate.js";

describe("normalizing an appointment time", () => {
  it("keeps a datetime-local value at the time that was typed", () => {
    const iso = normalizeScheduledFor("2026-09-04T14:00");
    expect(new Date(String(iso)).getHours()).toBe(14);
    expect(new Date(String(iso)).getDate()).toBe(4);
  });

  // A bare date is UTC midnight to `Date`, which reads back as the evening
  // before anywhere west of Greenwich — the 4th booked as the 3rd at 5pm.
  it("reads a bare date as that local day, not the evening before", () => {
    const at = new Date(String(normalizeScheduledFor("2026-09-04")));
    expect(at.getDate()).toBe(4);
    expect(at.getHours()).toBe(0);
  });

  it("still accepts an explicit UTC timestamp unchanged", () => {
    expect(normalizeScheduledFor("2026-09-04T14:00:00Z")).toBe(
      "2026-09-04T14:00:00.000Z",
    );
  });

  it("leaves blank blank, and refuses junk", () => {
    expect(normalizeScheduledFor("")).toBe("");
    expect(normalizeScheduledFor("next Tuesday")).toBeUndefined();
    // Without a four-digit year `Date` coerces "5" into 2001.
    expect(normalizeScheduledFor("5")).toBeUndefined();
  });
});

describe("a date of birth", () => {
  it("accepts a blank, and a real past date", () => {
    expect(isDob("")).toBe(true);
    expect(isDob("1990-02-28")).toBe(true);
  });

  it("refuses a date that never happened", () => {
    expect(isDob("2026-02-31")).toBe(false);
    expect(isDob("not-a-date")).toBe(false);
  });

  // After 5pm in Los Angeles UTC is already tomorrow. Comparing instants
  // rather than local days let tomorrow through for the rest of the evening.
  it("refuses tomorrow even once UTC has rolled over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T02:00:00Z")); // 3 Sep, 19:00 in LA
    expect(isDob("2026-09-03")).toBe(true);
    expect(isDob("2026-09-04")).toBe(false);
    vi.useRealTimers();
  });

  it("refuses a date in the future", () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    expect(isDob(nextYear.toISOString().slice(0, 10))).toBe(false);
  });
});
