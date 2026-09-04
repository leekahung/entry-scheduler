import { afterEach, describe, expect, it, vi } from "vitest";
import {
  byMonth,
  finishedBefore,
  mergeById,
  monthKey,
  monthTab,
} from "./archive.js";
import { makeEntry } from "../domain/entry.fixture.js";
import { fakeSheet } from "./sheet.fixture.js";
import { fromSheetValues, toSheetValues } from "./columns.js";
import { createStore, type SheetTransport } from "./store.js";

/** The month tabs a store writes to, each an in-memory sheet of its own. */
function fakeTabs() {
  const tabs = new Map<string, ReturnType<typeof fakeSheet>>();
  return {
    names: () => [...tabs.keys()],
    rows: (tab: string) => fromSheetValues(tabs.get(tab)?.current() ?? []),
    open(tab: string): SheetTransport {
      let sheet = tabs.get(tab);
      if (!sheet) {
        sheet = fakeSheet();
        tabs.set(tab, sheet);
      }
      return sheet.transport;
    },
  };
}

const AUGUST = "2026-08-15T12:00:00.000Z";
const SEPTEMBER = "2026-09-10T12:00:00.000Z";

describe("months as tabs", () => {
  it("names a tab the way staff read it", () => {
    expect(monthTab(monthKey(AUGUST))).toBe("August 2026");
  });

  it("files a row with no usable date under the current month", () => {
    expect(monthKey("")).toBe(monthKey(new Date().toISOString()));
  });

  it("splits the board by the month each entry was taken", () => {
    const months = byMonth([
      makeEntry({ id: 1, createdAt: AUGUST }),
      makeEntry({ id: 2, createdAt: SEPTEMBER }),
      makeEntry({ id: 3, createdAt: AUGUST }),
    ]);
    expect([...months.keys()]).toEqual(["2026-08", "2026-09"]);
    expect(months.get("2026-08")).toHaveLength(2);
  });

  it("counts only finished rows from an earlier month as ready to file", () => {
    const stale = finishedBefore(
      [
        makeEntry({ id: 1, createdAt: AUGUST, status: "resolved" }),
        makeEntry({ id: 2, createdAt: AUGUST, status: "new" }),
        makeEntry({ id: 3, createdAt: SEPTEMBER, status: "resolved" }),
      ],
      "2026-09",
    );
    expect(stale.map((entry) => entry.id)).toEqual([1]);
  });

  it("keeps two people who share a number from a month when numbering restarted", () => {
    const merged = mergeById(
      [
        makeEntry({
          id: 3,
          name: "Ada",
          createdAt: "2026-08-05T10:00:00.000Z",
        }),
      ],
      [makeEntry({ id: 3, name: "Bo", createdAt: "2026-08-20T10:00:00.000Z" })],
    );
    expect(merged.map((entry) => entry.name)).toEqual(["Ada", "Bo"]);
  });

  it("keeps rows a tab already holds when the board no longer has them", () => {
    const merged = mergeById(
      [makeEntry({ id: 1, name: "Filed" }), makeEntry({ id: 2, name: "Old" })],
      [
        makeEntry({ id: 2, name: "Updated" }),
        makeEntry({ id: 5, name: "New" }),
      ],
    );
    expect(merged.map((entry) => entry.name)).toEqual([
      "Filed",
      "Updated",
      "New",
    ]);
  });
});

describe("a store with month tabs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** An empty board, plus the month tabs it files into. */
  function board() {
    const tabs = fakeTabs();
    const live = fakeSheet();
    const store = createStore(live.transport, { openTab: tabs.open });
    return { tabs, live, store };
  }

  it("rewrites the board itself, so an older tab's headers are renamed", async () => {
    const { live, store } = board();
    await store.add("Ada", "");
    // A tab left by a version that named its columns differently.
    await live.transport.write([
      ["id", "status", "createdAt"],
      [1, "new", "2026-09-10T12:00:00.000Z"],
    ]);

    await store.sync();

    expect(live.current()[0]).toContain("ID");
    expect(live.current()[0]).not.toContain("id");
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("carries on with the queue when a month tab cannot be written", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const live = fakeSheet();
    const store = createStore(live.transport, {
      openTab: () => ({
        read: async () => [],
        write: async () => {
          throw new Error("Google said no");
        },
      }),
    });

    const done = await store.add("Ada", "");
    await store.update(done.id, { status: "resolved" });

    // The rollover is on the path of every write, so a month tab Google will
    // not take must not stop someone checking in.
    vi.setSystemTime(new Date(SEPTEMBER));
    await expect(store.add("Bo", "")).resolves.toMatchObject({ name: "Bo" });
    await store.settled();
    // And nothing may leave the board on the strength of a sync that failed.
    const left = await store.list();
    expect(left.map((entry) => entry.name)).toEqual(["Ada", "Bo"]);
  });

  it("copies the board without emptying it, even once the month has turned", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const { tabs, store } = board();
    const done = await store.add("Ada", "");
    await store.update(done.id, { status: "resolved" });
    await store.settled();

    vi.setSystemTime(new Date(SEPTEMBER));
    const result = await store.sync();

    expect(result.months).toEqual(["August 2026"]);
    expect(tabs.rows("August 2026").map((entry) => entry.name)).toEqual([
      "Ada",
    ]);
    // A copy, not a move: only a queue change files an ended month away.
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("saves the board into a tab per month without emptying it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(SEPTEMBER));
    const { tabs, store } = board();

    await store.add("Ada", "");
    const result = await store.sync();

    expect(result.months).toEqual(["September 2026"]);
    expect(tabs.rows("September 2026").map((e) => e.name)).toEqual(["Ada"]);
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("files finished entries from a month that has ended and takes them off the board", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const { tabs, store } = board();

    const done = await store.add("Ada", "");
    await store.update(done.id, { status: "resolved" });
    const open = await store.add("Bo", "");

    vi.setSystemTime(new Date(SEPTEMBER));
    await store.add("Cai", "");
    await store.settled();

    const left = await store.list();
    expect(left.map((entry) => entry.name)).toEqual(["Bo", "Cai"]);
    expect(tabs.rows("August 2026").map((entry) => entry.name)).toEqual([
      "Ada",
      "Bo",
    ]);
    expect(open.name).toBe("Bo");
  });

  /** A board whose month tabs cannot finish a write until it is released. */
  function heldBoard() {
    const tabs = fakeTabs();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const live = fakeSheet();
    const store = createStore(live.transport, {
      openTab: (tab) => {
        const sheet = tabs.open(tab);
        return {
          read: sheet.read,
          write: async (rows) => {
            await held;
            return sheet.write(rows);
          },
        };
      },
    });
    return { tabs, live, store, release: () => release() };
  }

  it("answers a check-in before filing the ended month away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const { tabs, store, release } = heldBoard();
    const done = await store.add("Ada", "");
    await store.update(done.id, { status: "resolved" });
    await store.settled();

    vi.setSystemTime(new Date(SEPTEMBER));
    // The visitor has their answer while the filing is still stuck on Google.
    await store.add("Bo", "");
    expect(tabs.rows("August 2026")).toEqual([]);

    release();
    await store.settled();
    expect(tabs.rows("August 2026").map((entry) => entry.name)).toEqual([
      "Ada",
    ]);
    const left = await store.list();
    expect(left.map((entry) => entry.name)).toEqual(["Bo"]);
  });

  it("keeps a check-in made during the filing behind it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const { store, release } = heldBoard();
    const done = await store.add("Ada", "");
    await store.update(done.id, { status: "resolved" });
    await store.settled();

    vi.setSystemTime(new Date(SEPTEMBER));
    await store.add("Bo", "");
    // Filing is still in flight; this must queue behind it rather than build
    // on the board it is about to trim.
    const during = store.add("Cai", "");
    release();
    await during;
    await store.settled();

    const left = await store.list();
    expect(left.map((entry) => entry.name)).toEqual(["Bo", "Cai"]);
  });

  it("files the months side by side rather than one after another", async () => {
    const live = fakeSheet(
      toSheetValues([
        makeEntry({ id: 1, createdAt: "2026-07-15T12:00:00.000Z" }),
        makeEntry({ id: 2, createdAt: AUGUST }),
        makeEntry({ id: 3, createdAt: SEPTEMBER }),
      ]),
    );
    let open = 0;
    let mostAtOnce = 0;
    const store = createStore(live.transport, {
      openTab: () => ({
        async read() {
          open += 1;
          mostAtOnce = Math.max(mostAtOnce, open);
          await new Promise((resolve) => setTimeout(resolve, 5));
          open -= 1;
          return [];
        },
        async write() {},
      }),
    });

    const result = await store.sync();
    expect(result.months).toEqual([
      "July 2026",
      "August 2026",
      "September 2026",
    ]);
    expect(mostAtOnce).toBe(3);
  });

  it("does not file an unfinished entry away, however old it is", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const { store } = board();
    await store.add("Ada", "");

    vi.setSystemTime(new Date(SEPTEMBER));
    await store.add("Bo", "");

    await expect(store.list()).resolves.toHaveLength(2);
  });

  it("keeps what a month tab already holds when the board is saved again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(AUGUST));
    const { tabs, store } = board();

    const done = await store.add("Ada", "");
    await store.update(done.id, { status: "resolved" });
    await store.add("Bo", "");

    // The rollover files Ada away; a later save must not wipe her row.
    vi.setSystemTime(new Date(SEPTEMBER));
    await store.add("Cai", "");
    await store.settled();
    await store.sync();

    expect(tabs.rows("August 2026").map((entry) => entry.name)).toEqual([
      "Ada",
      "Bo",
    ]);
    expect(tabs.names()).toEqual(["August 2026", "September 2026"]);
  });
});
