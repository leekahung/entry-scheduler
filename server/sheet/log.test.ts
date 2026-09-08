import { describe, expect, it } from "vitest";
import { toRows } from "./log.js";
import { makeEntry as entry } from "../domain/entry.fixture.js";

const HEADER = [
  "Date",
  "Client Name",
  "DOB",
  "Gender",
  "Phone #",
  "Case Type",
  "Appointment Type",
  "Appointment Outcome",
  "Notes",
  "Legal Outcome",
  "Time (0.25 increments)",
];

describe("toRows", () => {
  it("leads with the log headings, in the order the spreadsheet has them", () => {
    expect(toRows([])[0]).toEqual(HEADER);
  });

  it("sends values unescaped, since the push is RAW rather than a formula", () => {
    const [, row] = toRows([entry({ name: "=SUM(A1:A9)" })]);
    expect(row[1]).toBe("=SUM(A1:A9)");
  });

  it("keeps the header out of the entry count", () => {
    expect(toRows([]).length - 1).toBe(0);
    expect(toRows([entry(), entry({ id: 2 })]).length - 1).toBe(2);
  });
});
