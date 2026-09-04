import { describe, expect, it } from "vitest";
import { makeEntry } from "../domain/entry.fixture.js";
import { fromSheetValues, toSheetValues } from "./columns.js";

describe("the sheet as a record format", () => {
  it("round-trips every field of an entry", () => {
    const entry = makeEntry({
      id: 7,
      name: "Ada Lovelace",
      note: "needs an interpreter",
      adminNote: "staff only",
      status: "pending",
      helpedBy: "Kim",
      dob: "1990-01-02",
      gender: "Female",
      phone: "503-555-0142",
      caseType: "Housing/Eviction",
      appointmentType: "Consult",
      timeSpent: 0.75,
      priority: "urgent",
      scheduledFor: "2026-08-20T14:00:00.000Z",
    });
    expect(fromSheetValues(toSheetValues([entry]))).toEqual([entry]);
  });

  it("keeps the human log columns first, so the sheet still reads as a log", () => {
    const [header] = toSheetValues([]);
    expect(header.slice(0, 3)).toEqual(["Date", "Client Name", "DOB"]);
    expect(header).toContain("ID");
  });

  it("writes timestamps as a date and time staff can read", () => {
    const at = new Date(2026, 7, 5, 14, 15, 32);
    const [header, row] = toSheetValues([
      makeEntry({ createdAt: at.toISOString() }),
    ]);
    expect(row[header.indexOf("Signed In")]).toBe("2026-08-05 14:15:32");
    expect(fromSheetValues([header, row])[0].createdAt).toBe(at.toISOString());
  });

  it("leaves a walk-up's empty appointment time empty", () => {
    const [header, row] = toSheetValues([makeEntry({ scheduledFor: "" })]);
    expect(row[header.indexOf("Appointment Time")]).toBe("");
  });

  it("fits inside the A1:Z range the transport reads and writes", () => {
    const [header] = toSheetValues([]);
    // 26 columns. Past that, writes would silently fall outside the range.
    expect(header.length).toBeLessThanOrEqual(26);
  });

  it("keeps the two notes in their own columns rather than a merged one", () => {
    const [header, row] = toSheetValues([
      makeEntry({ note: "visitor", adminNote: "staff" }),
    ]);
    expect(row[header.indexOf("Notes")]).toBe("visitor");
    expect(row[header.indexOf("Staff Notes")]).toBe("staff");
    // The merged column the CSV log carries would repeat both of these.
    expect(header.filter((name) => String(name).includes("Notes"))).toEqual([
      "Notes",
      "Staff Notes",
    ]);
  });

  it("still reads a sheet written under the old machine headers", () => {
    const old = [
      ["id", "Notes", "note", "adminNote", "status", "helpedBy", "createdAt"],
      [
        4,
        "visitor\nstaff",
        "visitor",
        "staff",
        "pending",
        "Kim",
        "2026-08-05T10:00:00.000Z",
      ],
    ];
    expect(fromSheetValues(old)[0]).toMatchObject({
      id: 4,
      note: "visitor",
      adminNote: "staff",
      status: "pending",
      helpedBy: "Kim",
      createdAt: "2026-08-05T10:00:00.000Z",
    });
    const [back] = fromSheetValues(
      toSheetValues([makeEntry({ note: "visitor", adminNote: "staff" })]),
    );
    expect(back.note).toBe("visitor");
    expect(back.adminNote).toBe("staff");
  });

  it("reads by header name, so a column inserted by hand shifts nothing", () => {
    const [header, row] = toSheetValues([makeEntry({ id: 3, name: "Bo" })]);
    const shifted = [
      ["Staff scratch", ...header],
      ["ignore me", ...row],
    ];
    const [entry] = fromSheetValues(shifted);
    expect(entry.id).toBe(3);
    expect(entry.name).toBe("Bo");
  });

  it("skips rows with no id, so staff can leave notes in the sheet", () => {
    const [header, row] = toSheetValues([makeEntry({ id: 1 })]);
    expect(
      fromSheetValues([header, row, ["", "a note someone typed"], []]),
    ).toHaveLength(1);
  });

  it("falls back to safe values when a cell has been hand-edited to nonsense", () => {
    const [header, row] = toSheetValues([makeEntry({ id: 1 })]);
    row[header.indexOf("Status")] = "banana";
    row[header.indexOf("Priority")] = "";
    row[header.indexOf("Time (0.25 increments)")] = "not a number";
    const [entry] = fromSheetValues([header, row]);
    expect(entry.status).toBe("new");
    expect(entry.priority).toBe("routine");
    expect(entry.timeSpent).toBe(0);
  });
});
