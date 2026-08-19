import { describe, expect, it } from "vitest";
import { CASE_TYPE_LABEL, CASE_TYPES, CASE_TYPES_BY_LABEL } from "./codes.js";

describe("public case-type labels", () => {
  it("offers every code exactly once", () => {
    expect([...CASE_TYPES_BY_LABEL].sort()).toEqual([...CASE_TYPES].sort());
  });

  it("gives every code plain wording of its own", () => {
    const labels = CASE_TYPES.map((type) => CASE_TYPE_LABEL[type]);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("spells every acronym out in full", () => {
    expect(CASE_TYPE_LABEL["DVRO/CHRO"]).toMatch(/domestic violence/i);
    expect(CASE_TYPE_LABEL["DVRO/CHRO"]).toMatch(/civil harassment/i);
    expect(CASE_TYPE_LABEL.DCFS).toMatch(
      /department of children and family services/i,
    );
    expect(CASE_TYPE_LABEL["Child Support (CSSD)"]).toMatch(
      /child support services department/i,
    );
    expect(CASE_TYPE_LABEL["SSA Benefits"]).toMatch(
      /social security administration/i,
    );
  });

  it("leaves no bare acronym in the public wording", () => {
    for (const code of CASE_TYPES) {
      expect(CASE_TYPE_LABEL[code]).not.toMatch(
        /\b(CSSD|DCFS|DVRO|CHRO|SSA)\b/,
      );
    }
  });
});
