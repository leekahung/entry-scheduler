import { describe, expect, it } from "vitest";
import type { AdminEntry, Status } from "../shared/types";
import { queueSections } from "./queueSections";

/** Only the fields the split actually reads; the rest never reach it. */
const entry = (id: number, status: Status, due: boolean) =>
  ({ id, status, due }) as AdminEntry;

const idsOf = (rows: AdminEntry[]) => rows.map((row) => row.id);
const byId = (sections: ReturnType<typeof queueSections>, id: string) => {
  const found = sections.find((section) => section.id === id);
  if (!found) throw new Error(`no ${id} section`);
  return found;
};

describe("splitting the queue into tabs", () => {
  const rows = [
    entry(1, "new", true), // waiting
    entry(2, "pending", true), // being helped
    entry(3, "new", false), // scheduled later
    entry(4, "pending", false), // also later: not due yet
    entry(5, "resolved", true), // done
    entry(6, "resolved", false), // done, whatever its due flag says
  ];

  it("puts every entry in exactly one tab", () => {
    const sections = queueSections(rows, rows.length, false);
    expect(idsOf(byId(sections, "waiting").rows)).toEqual([1]);
    expect(idsOf(byId(sections, "helping").rows)).toEqual([2]);
    expect(idsOf(byId(sections, "later").rows)).toEqual([3, 4]);
    expect(idsOf(byId(sections, "done").rows)).toEqual([5, 6]);
  });

  it("keeps the tabs in the order staff read them", () => {
    expect(queueSections([], 0, false).map((s) => s.id)).toEqual([
      "waiting",
      "helping",
      "later",
      "done",
    ]);
  });
});

describe("what an empty tab says", () => {
  it("blames the filters when they are what emptied it", () => {
    const sections = queueSections([], 5, true);
    for (const section of sections) {
      expect(section.empty).toContain("filters");
    }
  });

  it("tells a brand-new queue apart from one that has been worked through", () => {
    expect(byId(queueSections([], 0, false), "waiting").empty).toBe(
      "No entries yet.",
    );
    expect(byId(queueSections([], 3, false), "waiting").empty).toBe(
      "Nobody is waiting — everyone has been helped.",
    );
  });

  it("says nothing about filters when none are on", () => {
    for (const section of queueSections([], 3, false)) {
      expect(section.empty).not.toContain("filters");
    }
  });
});
