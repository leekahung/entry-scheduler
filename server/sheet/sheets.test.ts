import { afterEach, describe, expect, it, vi } from "vitest";
import { googleTransport, sheetsConfig } from "./sheets.js";

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

  it("falls back to the first tab of a new spreadsheet", () => {
    expect(sheetsConfig(COMPLETE)?.tab).toBe("Sheet1");
    expect(sheetsConfig({ ...COMPLETE, GOOGLE_SHEETS_TAB: "2026" })?.tab).toBe(
      "2026",
    );
  });
});

describe("googleTransport", () => {
  const config = {
    spreadsheetId: "sheet-123",
    tab: "Sign In Log",
    credentials: null,
  };
  const token = async () => "test-token";
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Every fetch the transport made, as [url, init] pairs. */
  function record(response: unknown = {}) {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(ok(response));
    });
    return calls;
  }

  it("quotes a tab name with spaces, which A1 notation requires", async () => {
    const calls = record({ values: [] });
    await googleTransport(config, token).read();
    expect(calls[0][0]).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/'Sign%20In%20Log'!A1%3AZ",
    );
  });

  it("doubles a quote inside a tab name rather than ending the quoting", async () => {
    const calls = record({ values: [] });
    await googleTransport({ ...config, tab: "Ada's log" }, token).read();
    expect(calls[0][0]).toContain("'Ada''s%20log'!A1%3AZ");
  });

  it("reads an empty tab as no rows rather than undefined", async () => {
    record({});
    await expect(googleTransport(config, token).read()).resolves.toEqual([]);
  });

  it("writes in one request, so a half-finished write cannot empty the tab", async () => {
    const calls = record();
    await googleTransport(config, token).write([["id"], [1]]);
    expect(calls.map(([, init]) => init.method)).toEqual(["PUT"]);
    expect(calls.every(([url]) => !url.includes(":clear"))).toBe(true);
  });

  it("blanks the rows a shorter log leaves behind", async () => {
    const transport = googleTransport(config, token);
    const calls = record({ values: [["id"], [1], [2], [3]] });
    await transport.read();
    await transport.write([["id"], [1]]);

    const body = JSON.parse(String(calls[1][1].body)) as { values: string[][] };
    // Header plus one row, then blanks covering the two rows that were there.
    expect(body.values).toEqual([["id"], [1], [""], [""]]);
  });

  it("writes RAW so entry text is never evaluated as a formula", async () => {
    const calls = record();
    await googleTransport(config, token).write([["Client Name"], ["=SUM(A1)"]]);
    expect(calls[0][0]).toContain("valueInputOption=RAW");
    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      values: [["Client Name"], ["=SUM(A1)"]],
    });
  });

  it("leaves a missing log tab as a loud error, never a silent empty queue", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { message: "Unable to parse range: 'Typo'!A1:Z" },
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(googleTransport(config, token).read()).rejects.toThrow(
      /Unable to parse range/,
    );
  });

  it("reads a tab it is allowed to create as empty until it exists", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { message: "Unable to parse range: 'Staff'!A1:Z" },
          }),
          { status: 400 },
        ),
      ),
    );
    const staff = googleTransport({ ...config, tab: "Staff" }, token, {
      createMissing: true,
    });
    await expect(staff.read()).resolves.toEqual([]);
  });

  it("creates a tab it owns before writing to it", async () => {
    const calls = record();
    await googleTransport({ ...config, tab: "Staff One" }, token, {
      createMissing: true,
    }).write([["email"], ["kim@clinic.org"]]);
    // addSheet first, then the values write; neither one clears anything.
    expect(calls[0][0]).toContain(":batchUpdate");
    expect(calls[1][0]).toContain("valueInputOption=RAW");
    expect(calls.every(([url]) => !url.includes(":clear"))).toBe(true);
  });

  it("puts a month tab after the log rather than in front of it", async () => {
    const calls = record();
    await googleTransport({ ...config, tab: "August 2026" }, token, {
      createMissing: true,
      atIndex: 1,
    }).write([["ID"], [1]]);
    const body = JSON.parse(String(calls[0][1].body));
    expect(body.requests[0].addSheet.properties).toMatchObject({
      title: "August 2026",
      index: 1,
    });
  });

  it("explains a 403 as the sheet not being shared", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("denied", { status: 403 })),
    );
    await expect(googleTransport(config, token).read()).rejects.toThrow(
      /Share the spreadsheet/,
    );
  });
});
