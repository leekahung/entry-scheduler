import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry } from "./entry.fixture.js";
import { fakeSheet } from "./sheet.fixture.js";
import {
  CACHE_MS,
  createStore,
  fromSheetValues,
  toSheetValues,
  type SheetTransport,
} from "./store.js";

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

describe("the store", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("writes a new entry into the spreadsheet", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);

    const entry = await store.add("Ada", "hello");
    expect(entry.id).toBe(1);
    expect(entry.status).toBe("new");
    expect(sheet.current()).toHaveLength(2); // header + one row
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("numbers from the rows already in the sheet", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);

    await store.add("Ada", "");
    const second = await store.add("Bo", "");
    expect(second.id).toBe(2);
  });

  it("picks up an entry added to the spreadsheet by hand", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);
    await store.add("Ada", "");

    const values = sheet.current();
    const [header, row] = values;
    const typed = [...row];
    typed[header.indexOf("id")] = 9;
    typed[header.indexOf("Client Name")] = "Walked in";
    sheet.transport.write([...values, typed]);

    vi.useFakeTimers();
    vi.advanceTimersByTime(CACHE_MS + 1);
    const names = (await store.list()).map((entry) => entry.name);
    expect(names).toContain("Walked in");
  });

  it("leaves fields the update did not mention alone", async () => {
    const store = createStore(fakeSheet().transport);
    const entry = await store.add("Ada", "hello");

    const updated = await store.update(entry.id, { helpedBy: "Kim" });
    expect(updated?.helpedBy).toBe("Kim");
    expect(updated?.name).toBe("Ada");
    expect(updated?.note).toBe("hello");
  });

  it("clears the claim only when an entry is explicitly reopened", async () => {
    const store = createStore(fakeSheet().transport);
    const entry = await store.add("Ada", "");
    await store.update(entry.id, { status: "resolved", helpedBy: "Kim" });

    const stillClaimed = await store.update(entry.id, { adminNote: "x" });
    expect(stillClaimed?.helpedBy).toBe("Kim");

    const reopened = await store.update(entry.id, { status: "new" });
    expect(reopened?.helpedBy).toBe("");
  });

  it("reports an unknown id rather than writing", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);
    await store.add("Ada", "");
    const writes = sheet.counts.write;

    expect(await store.update(99, { helpedBy: "Kim" })).toBeUndefined();
    expect(await store.remove(99)).toBe(false);
    expect(sheet.counts.write).toBe(writes);
  });

  it("serves repeat reads from cache, so polling does not spend the quota", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);
    await store.list();
    await store.list();
    await store.list();
    expect(sheet.counts.read).toBe(1);
  });

  it("goes back to the spreadsheet once the cache is stale", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);
    await store.list();

    vi.useFakeTimers();
    vi.advanceTimersByTime(CACHE_MS + 1);
    await store.list();
    expect(sheet.counts.read).toBe(2);
  });

  it("keeps concurrent writes from overwriting each other", async () => {
    const sheet = fakeSheet();
    const store = createStore(sheet.transport);

    const added = await Promise.all([
      store.add("Ada", ""),
      store.add("Bo", ""),
      store.add("Cai", ""),
    ]);

    expect(added.map((entry) => entry.id).sort()).toEqual([1, 2, 3]);
    await expect(store.list()).resolves.toHaveLength(3);
  });

  it("carries on after a failed write instead of wedging the queue", async () => {
    const sheet = fakeSheet();
    let failNext = true;
    const flaky: SheetTransport = {
      read: sheet.transport.read,
      write(values) {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("Google said no"));
        }
        return sheet.transport.write(values);
      },
    };
    const store = createStore(flaky);

    await expect(store.add("Ada", "")).rejects.toThrow("Google said no");
    await expect(store.add("Bo", "")).resolves.toMatchObject({ name: "Bo" });
  });
});
