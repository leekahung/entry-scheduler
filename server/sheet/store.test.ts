import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSheet, fakeTabs } from "./sheet.fixture.js";
import { CACHE_MS, createStore, type SheetTransport } from "./store.js";
import { currentMonth, monthTab } from "./archive.js";

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

  it("keeps the claim on an entry that is merely edited", async () => {
    const store = createStore(fakeSheet().transport);
    const entry = await store.add("Ada", "");
    await store.update(entry.id, { status: "resolved", helpedBy: "Kim" });

    const stillClaimed = await store.update(entry.id, { adminNote: "x" });
    expect(stillClaimed?.helpedBy).toBe("Kim");
  });

  // Kim did the work; reopening the row does not unmake that, and "Helped by"
  // is what the sign-in log records it as.
  it("keeps the claim when a finished entry is reopened", async () => {
    const store = createStore(fakeSheet().transport);
    const entry = await store.add("Ada", "");
    await store.update(entry.id, { status: "resolved", helpedBy: "Kim" });

    const reopened = await store.update(entry.id, { status: "new" });
    expect(reopened?.helpedBy).toBe("Kim");
  });

  // Nobody helped them: the row was started by mistake and put back.
  it("drops the claim when someone being helped goes back to waiting", async () => {
    const store = createStore(fakeSheet().transport);
    const entry = await store.add("Ada", "");
    await store.update(entry.id, { status: "pending", helpedBy: "Kim" });

    const back = await store.update(entry.id, { status: "new" });
    expect(back?.helpedBy).toBe("");
  });

  it("keeps a removed entry, off the board but able to come back", async () => {
    const store = createStore(fakeSheet().transport);
    const entry = await store.add("Ada", "left early");

    expect(await store.remove(entry.id)).toBe(true);
    const [removed] = await store.list();
    expect(removed?.deletedAt).not.toBe("");
    // A second removal has nothing to do.
    expect(await store.remove(entry.id)).toBe(false);

    expect(await store.restore(entry.id)).toBe(true);
    expect((await store.list())[0]?.deletedAt).toBe("");
    // And nothing to restore once it is back.
    expect(await store.restore(entry.id)).toBe(false);
  });

  // Clean reporting: the log is what the clinic worked, and a removed row is
  // one nobody worked.
  it("files a removed entry like any other, and leaves it out of the workbook", async () => {
    const tabs = fakeTabs();
    const store = createStore(fakeSheet().transport, { tabs });
    await store.add("Ada", "");
    const going = await store.add("Bo", "");
    await store.remove(going.id);
    await store.sync();
    await store.settled();

    // The sheet is the record, so the row is still in it and putting Bo back
    // has something to put back.
    expect(tabs.rows(monthTab(currentMonth())).map((row) => row.name)).toEqual([
      "Ada",
      "Bo",
    ]);
    // The workbook describes the clinic's work, so it is not in that.
    const months = await store.months();
    expect(months[0].entries.map((entry) => entry.name)).toEqual(["Ada"]);
  });

  // Only erasing takes a row off the sheet. A removal reaching that would be
  // the one thing the erase route's three guards exist to hold shut.
  it("leaves a filed row where it is when the entry is merely removed", async () => {
    const tabs = fakeTabs();
    const store = createStore(fakeSheet().transport, { tabs });
    const entry = await store.add("Ada", "");
    await store.sync();
    expect(tabs.rows(monthTab(currentMonth()))).toHaveLength(1);

    await store.remove(entry.id);
    await store.sync();
    await store.settled();
    expect(tabs.rows(monthTab(currentMonth()))).toHaveLength(1);

    expect(await store.purge(entry.id)).toBe(true);
    await store.settled();
    expect(tabs.rows(monthTab(currentMonth()))).toHaveLength(0);
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

  it("shares one read between the polls that land together", async () => {
    let reads = 0;
    const transport: SheetTransport = {
      async read() {
        reads += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [];
      },
      async write() {},
    };
    const store = createStore(transport);

    // A waiting room's worth of five-second polling, all of it landing while
    // the one read is still on its way to Google.
    await Promise.all(Array.from({ length: 20 }, () => store.list()));
    expect(reads).toBe(1);
  });

  it("does not let a poll already in flight put its stale board back", async () => {
    let rows: (string | number)[][] = [];
    let landed: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      landed = resolve;
    });
    let reads = 0;
    const transport: SheetTransport = {
      async read() {
        reads += 1;
        // The first read is a poll that saw the board empty and only comes
        // back after the check-in behind it has already saved.
        if (reads === 1) {
          const before = rows;
          await held;
          return before;
        }
        return rows;
      },
      async write(next) {
        rows = next;
      },
    };
    const store = createStore(transport);

    const polling = store.list();
    await store.add("Ada", "");
    landed();
    await expect(polling).resolves.toEqual([]);

    // Ada must not go back off the board until the cache next expires.
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("does not let a read taken during a slow write put the old board back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let rows: (string | number)[][] = [];
    let releaseWrite: () => void = () => {};
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let releaseRead: () => void = () => {};
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reads = 0;
    const transport: SheetTransport = {
      async read() {
        reads += 1;
        // The second read is a poll that starts while the write is still in
        // flight, so it sees the board as it was and lands after the save.
        if (reads === 2) {
          const before = rows;
          await readHeld;
          return before;
        }
        return rows;
      },
      async write(next) {
        await writeHeld;
        rows = next;
      },
    };
    const store = createStore(transport);

    const added = store.add("Ada", "");
    await vi.advanceTimersByTimeAsync(1);
    // The write outlives the cache it was built on — reachable now that a
    // rate-limited call backs off for seconds before it lands.
    await vi.advanceTimersByTimeAsync(CACHE_MS + 1);
    const polling = store.list();

    releaseWrite();
    await added;
    releaseRead();
    await polling;

    await expect(store.list()).resolves.toHaveLength(1);
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
