import { describe, expect, it } from "vitest";
import { fromStamp, toStamp } from "./stamp.js";

describe("timestamps as staff read them", () => {
  it("writes and reads back the same moment", () => {
    const at = new Date(2026, 7, 5, 14, 15, 32);
    expect(toStamp(at.toISOString())).toBe("2026-08-05 14:15:32");
    expect(fromStamp("2026-08-05 14:15:32")).toBe(at.toISOString());
  });

  it("reads the ISO an older sheet holds", () => {
    expect(fromStamp("2026-08-05T10:00:00.000Z")).toBe(
      "2026-08-05T10:00:00.000Z",
    );
  });

  it("leaves an empty cell empty, which is what a walk-up's appointment is", () => {
    expect(fromStamp("")).toBe("");
    expect(fromStamp("   ")).toBe("");
    expect(toStamp("")).toBe("");
  });

  it("reads a bare date as that local day, not the one before it", () => {
    expect(toStamp(fromStamp("2026-08-05"))).toBe("2026-08-05 00:00:00");
  });

  it("keeps a cell no date can be read from, rather than erasing it", () => {
    // The board is written back on every change, so anything dropped here is
    // gone from the spreadsheet too.
    expect(fromStamp("Aug 5th, around 2")).toBe("Aug 5th, around 2");
    expect(toStamp("Aug 5th, around 2")).toBe("Aug 5th, around 2");
    expect(toStamp(fromStamp("Aug 5th, around 2"))).toBe("Aug 5th, around 2");
  });
});
