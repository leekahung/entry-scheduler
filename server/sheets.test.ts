import { describe, expect, it } from "vitest";
import { toRows } from "./csv.js";
import { makeEntry as entry } from "./entry.fixture.js";
import { sheetRequests, sheetsConfig } from "./sheets.js";

const COMPLETE = {
  GOOGLE_SHEETS_ID: "sheet-123",
  GOOGLE_SA_EMAIL: "clinic@project.iam.gserviceaccount.com",
  GOOGLE_SA_KEY:
    "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
};

describe("sheetsConfig", () => {
  it("is null without a spreadsheet, so the feature stays off", () => {
    expect(sheetsConfig({})).toBeNull();
    expect(sheetsConfig({ ...COMPLETE, GOOGLE_SHEETS_ID: "  " })).toBeNull();
  });

  it("leaves credentials null when no key is set, for a keyless host", () => {
    const config = sheetsConfig({ GOOGLE_SHEETS_ID: "sheet-123" });
    expect(config?.credentials).toBeNull();
    expect(sheetsConfig({ ...COMPLETE, GOOGLE_SA_KEY: "" })?.credentials).toBe(
      null,
    );
  });

  it("turns the escaped newlines of a .env key back into real ones", () => {
    const config = sheetsConfig(COMPLETE);
    expect(config?.credentials?.privateKey).toBe(
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
  });

  it("falls back to the sign-in log tab", () => {
    expect(sheetsConfig(COMPLETE)?.tab).toBe("Sign In Log");
    expect(sheetsConfig({ ...COMPLETE, GOOGLE_SHEETS_TAB: "2026" })?.tab).toBe(
      "2026",
    );
  });
});

describe("toRows", () => {
  it("sends values unescaped, since the push is RAW rather than a formula", () => {
    const [, row] = toRows([entry({ name: "=SUM(A1:A9)" })]);
    expect(row[1]).toBe("=SUM(A1:A9)");
  });

  it("keeps the header out of the entry count", () => {
    expect(toRows([]).length - 1).toBe(0);
    expect(toRows([entry(), entry({ id: 2 })]).length - 1).toBe(2);
  });
});

describe("sheetRequests", () => {
  const config = {
    spreadsheetId: "sheet-123",
    tab: "Sign In Log",
    credentials: null,
  };

  it("clears the tab before writing, so a re-sync leaves one copy", () => {
    const { requests } = sheetRequests(config, [entry()]);
    expect(requests.map((r) => r.method)).toEqual(["POST", "PUT"]);
    expect(requests[0].path).toContain(":clear");
  });

  it("escapes the tab name into the range", () => {
    const { requests } = sheetRequests(config, []);
    expect(requests[0].path).toBe(
      "sheet-123/values/Sign%20In%20Log!A1%3AZ:clear",
    );
  });

  it("writes RAW so entry text is never evaluated as a formula", () => {
    const { requests } = sheetRequests(config, []);
    expect(requests[1].path).toContain("valueInputOption=RAW");
  });

  it("sends the header plus one row per entry and counts only the entries", () => {
    const { requests, rows } = sheetRequests(config, [
      entry({ name: "Ada" }),
      entry({ id: 2, name: "Bo" }),
    ]);
    const values = (requests[1].body as { values: string[][] }).values;
    expect(values[0][1]).toBe("Client Name");
    expect(values.map((row) => row[1])).toEqual(["Client Name", "Ada", "Bo"]);
    expect(rows).toBe(2);
  });
});
