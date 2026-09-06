import { fromSheetValues } from "./columns.js";
import type { TabStore } from "./sheets.js";
import type { SheetTransport } from "./store.js";

/** A spreadsheet in memory, counting the calls a store makes to it. */
export function fakeSheet(initial: (string | number)[][] = []) {
  let values = initial;
  const counts = { read: 0, write: 0 };
  const transport: SheetTransport = {
    async read() {
      counts.read += 1;
      return values;
    },
    async write(next) {
      counts.write += 1;
      values = next;
    },
  };
  return { transport, counts, current: () => values };
}

/** The month tabs in memory, counting the batched calls a store makes. */
export function fakeTabs(initial: Record<string, (string | number)[][]> = {}) {
  const sheets = new Map<string, (string | number)[][]>(
    Object.entries(initial),
  );
  const counts = { list: 0, read: 0, write: 0 };
  const store: TabStore = {
    async list() {
      counts.list += 1;
      return [...sheets.keys()];
    },
    async read(names) {
      counts.read += 1;
      return new Map(names.map((name) => [name, sheets.get(name) ?? []]));
    },
    async write(writes) {
      counts.write += 1;
      for (const { tab, values } of writes) sheets.set(tab, values);
    },
  };
  return Object.assign(store, {
    counts,
    names: () => [...sheets.keys()],
    current: (tab: string) => sheets.get(tab) ?? [],
    /** What a month tab ended up holding, as entries. */
    rows: (tab: string) => fromSheetValues(sheets.get(tab) ?? []),
  });
}
