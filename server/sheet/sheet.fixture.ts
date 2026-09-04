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
