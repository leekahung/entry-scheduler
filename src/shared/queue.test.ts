import { describe, expect, it } from "vitest";
import { isInRoom, isScheduledLater } from "./queue";

describe("where an entry stands", () => {
  it("puts an unfinished, due entry in the room", () => {
    expect(isInRoom({ status: "new", due: true })).toBe(true);
    expect(isInRoom({ status: "pending", due: true })).toBe(true);
    expect(isInRoom({ status: "resolved", due: true })).toBe(false);
    expect(isInRoom({ status: "new", due: false })).toBe(false);
  });

  it("schedules an unfinished entry that is not due yet", () => {
    expect(isScheduledLater({ status: "new", due: false })).toBe(true);
    expect(isScheduledLater({ status: "resolved", due: false })).toBe(false);
    expect(isScheduledLater({ status: "new", due: true })).toBe(false);
  });
});
