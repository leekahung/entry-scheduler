import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googleTabs,
  googleTransport,
  RETRIES,
  sheetsConfig,
} from "./sheets.js";

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

  it("explains a 403 as the sheet not being shared", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("denied", { status: 403 })),
    );
    await expect(googleTransport(config, token).read()).rejects.toThrow(
      /Share the spreadsheet/,
    );
  });

  describe("when Google is busy rather than unhappy", () => {
    /** Fails `failures` times with `status`, then answers normally. */
    function flaky(status: number, failures: number) {
      let calls = 0;
      vi.stubGlobal("fetch", () => {
        calls += 1;
        return Promise.resolve(
          calls <= failures
            ? new Response("rate limit exceeded", { status })
            : ok({ values: [["ID"], [1]] }),
        );
      });
      return () => calls;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("comes back after a rate limit rather than failing the check-in", async () => {
      vi.useFakeTimers();
      const calls = flaky(429, 2);

      const read = googleTransport(config, token).read();
      await vi.runAllTimersAsync();

      await expect(read).resolves.toEqual([["ID"], [1]]);
      expect(calls()).toBe(3);
    });

    it("retries a write too, which is safe because it rewrites the whole tab", async () => {
      vi.useFakeTimers();
      const calls = flaky(503, 1);

      const write = googleTransport(config, token).write([["ID"], [1]]);
      await vi.runAllTimersAsync();

      await expect(write).resolves.toBeUndefined();
      expect(calls()).toBe(2);
    });

    it("waits longer after each failure, so a retry cannot keep a limit tripped", async () => {
      vi.useFakeTimers();
      const waits: number[] = [];
      const slept = vi.spyOn(globalThis, "setTimeout");
      flaky(429, RETRIES);

      const read = googleTransport(config, token).read();
      await vi.runAllTimersAsync();
      await read;

      for (const [, ms] of slept.mock.calls) waits.push(Number(ms));
      expect(waits).toHaveLength(RETRIES);
      expect(waits[1]).toBeGreaterThan(waits[0]);
      expect(waits[2]).toBeGreaterThan(waits[1]);
      slept.mockRestore();
    });

    it("comes back after a dropped connection, not just a refusal", async () => {
      vi.useFakeTimers();
      let calls = 0;
      vi.stubGlobal("fetch", () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : Promise.resolve(ok({ values: [["ID"], [1]] }));
      });

      const read = googleTransport(config, token).read();
      await vi.runAllTimersAsync();

      await expect(read).resolves.toEqual([["ID"], [1]]);
      expect(calls).toBe(2);
    });

    it("gives up on a connection that never comes back", async () => {
      vi.useFakeTimers();
      let calls = 0;
      vi.stubGlobal("fetch", () => {
        calls += 1;
        return Promise.reject(new TypeError("fetch failed"));
      });

      const read = expect(
        googleTransport(config, token).read(),
      ).rejects.toThrow(/fetch failed/);
      await vi.runAllTimersAsync();
      await read;

      expect(calls).toBe(RETRIES + 1);
    });

    it("gives up once the retries are spent", async () => {
      vi.useFakeTimers();
      const calls = flaky(503, Number.POSITIVE_INFINITY);

      const read = expect(
        googleTransport(config, token).read(),
      ).rejects.toThrow(/Google Sheets error 503/);
      await vi.runAllTimersAsync();
      await read;

      expect(calls()).toBe(RETRIES + 1);
    });

    it("does not retry a sheet that was never shared, which will not clear", async () => {
      const calls = flaky(403, Number.POSITIVE_INFINITY);
      await expect(googleTransport(config, token).read()).rejects.toThrow(
        /Share the spreadsheet/,
      );
      expect(calls()).toBe(1);
    });
  });
});

describe("googleTabs", () => {
  const config = {
    spreadsheetId: "sheet-123",
    tab: "Sign In Log",
    credentials: null,
  };
  const token = async () => "test-token";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Every fetch made, answering each with the body the caller supplies. */
  function record(responder: (url: string) => unknown = () => ({})) {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(
        new Response(JSON.stringify(responder(url)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    return calls;
  }

  it("asks for every tab in one request, which Google counts as one", async () => {
    const calls = record(() => ({
      valueRanges: [
        { range: "'August 2026'!A1:Z", values: [["a"]] },
        { range: "'September 2026'!A1:Z", values: [["b"]] },
      ],
    }));

    const rows = await googleTabs(config, token).read([
      "August 2026",
      "September 2026",
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("/values:batchGet?");
    expect(calls[0][0]).toContain("ranges='August%202026'!A1%3AZ");
    expect(calls[0][0]).toContain("ranges='September%202026'!A1%3AZ");
    expect(rows.get("August 2026")).toEqual([["a"]]);
    expect(rows.get("September 2026")).toEqual([["b"]]);
  });

  it("reads a tab that is not there yet as empty, not as a failure", async () => {
    record(() => ({ valueRanges: [{ range: "'July 2026'!A1:Z" }] }));
    const rows = await googleTabs(config, token).read(["July 2026"]);
    expect(rows.get("July 2026")).toEqual([]);
  });

  it("blanks the rows a shorter write no longer covers", async () => {
    const calls = record((url) =>
      url.includes("/values:batchGet")
        ? {
            valueRanges: [
              {
                range: "'August 2026'!A1:Z",
                // Three rows in the tab, but the middle one carries no id, so
                // the merge that comes back is a row shorter than what is there.
                values: [["id"], ["1"], ["hand-typed note"]],
              },
            ],
          }
        : {},
    );
    const tabs = googleTabs(config, token);

    await tabs.read(["August 2026"]);
    await tabs.write([{ tab: "August 2026", values: [["id"], ["1"]] }]);

    const write = calls.find(([url]) => url.includes("/values:batchUpdate"));
    // The third row is written back as blanks rather than left standing as a
    // duplicate under the new ones.
    expect(JSON.parse(String(write?.[1].body)).data[0].values).toEqual([
      ["id"],
      ["1"],
      [""],
    ]);
  });

  it("asks for nothing when there is nothing to read", async () => {
    const calls = record();
    await googleTabs(config, token).read([]);
    expect(calls).toHaveLength(0);
  });

  it("creates the tabs it has not seen in one call, then writes in one more", async () => {
    const calls = record();
    await googleTabs(config, token).write([
      { tab: "August 2026", values: [["a"]] },
      { tab: "September 2026", values: [["b"]] },
    ]);

    expect(calls).toHaveLength(2);
    const [create, write] = calls;
    expect(create[0]).toContain(":batchUpdate");
    const requests = JSON.parse(String(create[1].body)).requests;
    expect(requests).toHaveLength(2);
    // Index 1 keeps the live log first and pushes older months to the right.
    expect(requests[0].addSheet.properties).toEqual({
      title: "August 2026",
      index: 1,
    });

    expect(write[0]).toContain("/values:batchUpdate");
    const body = JSON.parse(String(write[1].body));
    // RAW, or a name beginning "=" is evaluated as a formula.
    expect(body.valueInputOption).toBe("RAW");
    expect(body.data).toEqual([
      { range: "'August 2026'!A1:Z", values: [["a"]] },
      { range: "'September 2026'!A1:Z", values: [["b"]] },
    ]);
  });

  it("does not ask twice for a tab it has already seen", async () => {
    const tabs = googleTabs(config, token);
    record(() => ({ valueRanges: [{ range: "'August 2026'!A1:Z" }] }));
    await tabs.read(["August 2026"]);

    const calls = record();
    await tabs.write([{ tab: "August 2026", values: [["a"]] }]);
    // Reading it proved it exists, so there is nothing to create.
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("/values:batchUpdate");
  });

  it("carries on when the tabs it tried to create were already there", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.endsWith(":batchUpdate") && !url.includes("/values:")
          ? new Response('{"error":{"message":"A sheet already exists"}}', {
              status: 400,
            })
          : new Response("{}", { status: 200 }),
      ),
    );
    await expect(
      googleTabs(config, token).write([{ tab: "August 2026", values: [] }]),
    ).resolves.toBeUndefined();
  });

  it("doubles a quote inside a tab name rather than ending the quoting", async () => {
    const calls = record();
    await googleTabs(config, token).write([
      { tab: "Ada's month", values: [["a"]] },
    ]);
    const body = JSON.parse(String(calls[1][1].body));
    expect(body.data[0].range).toBe("'Ada''s month'!A1:Z");
  });

  it("splits a long history into batches, to bound one response", async () => {
    const months = Array.from({ length: 60 }, (_, i) => `Month ${i}`);
    const calls = record(() => ({ valueRanges: [] }));
    await googleTabs(config, token).read(months);
    // 60 tabs at 24 a batch: three requests rather than sixty.
    expect(calls).toHaveLength(3);
  });
});
