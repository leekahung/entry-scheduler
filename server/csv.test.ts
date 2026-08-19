import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";
import { makeEntry as entry } from "./entry.fixture.js";

const HEADER =
  "Date,Client Name,DOB,Gender,Phone #,Case Type,Appointment Type," +
  "Appointment Outcome,Notes,Legal Outcome,Time (0.25 increments)";

describe("toCsv", () => {
  it("emits a header row even with no entries", () => {
    expect(toCsv([])).toBe(`${HEADER}\r\n`);
  });

  it("lays a row out in the sign-in log's column order", () => {
    const csv = toCsv([
      entry({
        name: "Ada",
        dob: "1990-04-02",
        gender: "Female",
        phone: "503-555-0142",
        caseType: "Housing/Eviction",
        appointmentType: "Consult",
        appointmentOutcome: "Completed",
        legalOutcome: "REFERRAL MADE",
        timeSpent: 1.25,
      }),
    ]);
    expect(csv.trim().split("\r\n")[1]).toBe(
      '"2026-08-05","Ada","1990-04-02","Female","503-555-0142","Housing/Eviction",' +
        '"Consult","Completed","","REFERRAL MADE","1.25"',
    );
  });

  it("keeps both the visitor note and the admin note in Notes", () => {
    const csv = toCsv([
      entry({ note: "eviction notice", adminNote: "urgent" }),
    ]);
    expect(csv).toContain('"eviction notice\nurgent"');
  });

  it("leaves an unlogged time blank rather than writing a zero", () => {
    expect(toCsv([entry()]).trim().endsWith('""')).toBe(true);
  });

  it("escapes quotes, commas, and newlines in free text", () => {
    const csv = toCsv([
      entry({ name: 'Ada "Countess" Lovelace', note: "line1\nline2, more" }),
    ]);
    expect(csv).toContain('"Ada ""Countess"" Lovelace"');
    expect(csv).toContain('"line1\nline2, more"');
  });

  it("neutralizes spreadsheet formula injection", () => {
    const csv = toCsv([entry({ name: "=SUM(A1:A9)" })]);
    expect(csv).toContain('"\'=SUM(A1:A9)"');
  });

  it("neutralizes every character a spreadsheet reads as a formula", () => {
    // A client types their own name; Excel must never execute it. All five
    // lead characters the guard covers need to be pinned, not just "=".
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      const csv = toCsv([entry({ name: `${lead}cmd|' /c calc'!A1` })]);
      expect(csv).toContain(`"'${lead}cmd`);
    }
  });

  it("leaves a name that merely contains those characters alone", () => {
    // Only a leading character is dangerous — quoting mid-string would
    // mangle ordinary names and notes.
    const csv = toCsv([entry({ name: "Jean-Luc Picard", note: "a+b@c" })]);
    expect(csv).toContain('"Jean-Luc Picard"');
    expect(csv).toContain('"a+b@c"');
  });
});
