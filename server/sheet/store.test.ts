import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSheet } from "./sheet.fixture.js";
import { CACHE_MS, createStore, type SheetTransport } from "./store.js";

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
