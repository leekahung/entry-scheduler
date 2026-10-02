import {
  accessToken,
  addSheets,
  call,
  type GetToken,
  padTo,
  rangeOf,
  type SheetsConfig,
} from "./client.js";
import type { SheetTransport } from "./store.js";

/**
 * Reads and writes the whole log tab over the Sheets API.
 * Never clear-then-write, which could leave the queue empty; a shorter log is
 * blanked by padding to the tab's previous extent.
 */
export function googleTransport(
  config: SheetsConfig,
  getToken: GetToken = accessToken,
  // Only for tabs the app owns, such as the staff list. Never the log: a typo
  // must fail loudly, not read an empty new tab as an empty queue.
  { createMissing = false }: { createMissing?: boolean } = {},
): SheetTransport {
  const range = encodeURIComponent(rangeOf(config.tab));
  const values = `${config.spreadsheetId}/values/${range}`;
  // Rows the tab last held, so a write knows how far down to blank.
  let extent = 0;

  return {
    async read() {
      const token = await getToken(config);
      let res: Response;
      try {
        res = await call(config, token, values, { method: "GET" });
      } catch (error) {
        // Sheets reports an absent tab as an unparseable range. A tab that has
        // not been created yet is empty, not an error.
        if (createMissing && isMissingTab(error)) return [];
        throw error;
      }
      const body = (await res.json()) as { values?: (string | number)[][] };
      const rows = body.values ?? [];
      extent = Math.max(extent, rows.length);
      return rows;
    },

    async write(rows) {
      const token = await getToken(config);
      if (createMissing) await ensureTab(config, token);
      // RAW, never USER_ENTERED: a name beginning "=" must land as text, not
      // as a formula for the spreadsheet to evaluate.
      await call(config, token, `${values}?valueInputOption=RAW`, {
        method: "PUT",
        body: { values: padTo(rows, extent) },
      });
      extent = rows.length;
    },
  };
}

/** True for the error Sheets returns when the named tab does not exist. */
function isMissingTab(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("Unable to parse range")
  );
}

const created = new Set<string>();

/**
 * Creates the tab if the spreadsheet does not have it yet.
 * Remembered per process, so this costs one request rather than one per write.
 */
async function ensureTab(config: SheetsConfig, token: string): Promise<void> {
  const key = `${config.spreadsheetId}:${config.tab}`;
  if (created.has(key)) return;
  // Already there is the normal case: either way the tab now exists.
  await addSheets(config, token, [config.tab]);
  created.add(key);
}
