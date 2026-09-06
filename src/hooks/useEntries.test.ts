import { describe, expect, it } from "vitest";
import { syncedMonths } from "./useEntries";

describe("what a sync says it wrote", () => {
  it("names one month", () => {
    expect(syncedMonths(["September 2026"])).toBe("Synced September 2026.");
  });

  it("joins two with and, not a comma", () => {
    expect(syncedMonths(["August 2026", "September 2026"])).toBe(
      "Synced August 2026 and September 2026.",
    );
  });

  it("punctuates three properly", () => {
    expect(syncedMonths(["July 2026", "August 2026", "September 2026"])).toBe(
      "Synced July 2026, August 2026, and September 2026.",
    );
  });

  it("counts them once a list would stop being read", () => {
    const year = Array.from({ length: 12 }, (_, i) => `Month ${i} 2026`);
    // A board that has never been filed spans a year, and twelve tab names in
    // a toast is not a sentence anyone reads.
    expect(syncedMonths(year)).toBe("Synced 12 months.");
  });

  it("says so when there was nothing to write", () => {
    expect(syncedMonths([])).toBe("Nothing to sync — the board is empty.");
  });
});
