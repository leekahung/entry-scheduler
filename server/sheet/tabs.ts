import {
  accessToken,
  addSheets,
  call,
  type GetToken,
  padTo,
  rangeOf,
  type SheetsConfig,
  sheetProperties,
} from "./client.js";

/**
 * Every tab in the spreadsheet, in the order it holds them.
 * The export needs this to find the months already filed away: those are tabs
 * of their own and no longer on the board.
 */
async function listTabs(
  config: SheetsConfig,
  getToken: GetToken,
): Promise<string[]> {
  const sheets = await sheetProperties(config, await getToken(config));
  return sheets
    .map(({ title }) => title)
    .filter((title): title is string => Boolean(title));
}

/**
 * Tabs per batched call. Google counts a batch as one request, so this only
 * caps the size of a single response.
 */
const BATCH = 24;

const chunked = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

/** The name back out of a range, for pairing a response with what was asked. */
const tabOf = (range: string) =>
  (range.split("!")[0] ?? "").replace(/^'|'$/g, "").replace(/''/g, "'");

/**
 * Reads and writes whole tabs in batches, which Google counts as one request
 * each — rather than tens of calls against the per-minute quota.
 */
export type TabStore = {
  /** Every tab the spreadsheet holds. */
  list(): Promise<string[]>;
  /** The named tabs' rows. A tab that does not exist yet reads as empty. */
  read(tabs: string[]): Promise<Map<string, (string | number)[][]>>;
  /** Writes the named tabs, creating any the spreadsheet does not have. */
  write(
    writes: { tab: string; values: (string | number)[][] }[],
  ): Promise<void>;
};

export function googleTabs(
  config: SheetsConfig,
  getToken: GetToken = accessToken,
): TabStore {
  // Which tabs are known to exist, so filing the same month twice does not
  // ask Google to create it twice.
  const known = new Set<string>();
  // How many rows each tab was last seen holding. A merge can come back
  // shorter (rows without an id drop), and the old tail must be blanked.
  const extent = new Map<string, number>();

  return {
    list: () => listTabs(config, getToken),

    async read(tabs) {
      const rows = new Map<string, (string | number)[][]>();
      if (tabs.length === 0) return rows;
      const token = await getToken(config);

      for (const group of chunked(tabs, BATCH)) {
        const ranges = group
          .map((tab) => `ranges=${encodeURIComponent(rangeOf(tab))}`)
          .join("&");
        const res = await call(
          config,
          token,
          `${config.spreadsheetId}/values:batchGet?${ranges}`,
          { method: "GET" },
        );
        const body = (await res.json()) as {
          valueRanges?: { range?: string; values?: (string | number)[][] }[];
        };
        // Google answers in the order it was asked, but it names each range
        // back, so pair on the name rather than trusting the position.
        for (const [index, value] of (body.valueRanges ?? []).entries()) {
          const tab = value.range ? tabOf(value.range) : group[index];
          if (tab) {
            const values = value.values ?? [];
            rows.set(tab, values);
            extent.set(tab, Math.max(extent.get(tab) ?? 0, values.length));
            known.add(tab);
          }
        }
      }
      return rows;
    },

    async write(writes) {
      if (writes.length === 0) return;
      const token = await getToken(config);

      // Create unseen tabs in one call, at index 1 after the log. Remembered
      // only if it lands: "already exists" leaves which ones exist unknown.
      const missing = writes
        .map(({ tab }) => tab)
        .filter((tab) => !known.has(tab));
      if (missing.length > 0 && (await addSheets(config, token, missing, 1))) {
        for (const tab of missing) known.add(tab);
      }

      for (const group of chunked(writes, BATCH)) {
        // RAW, never USER_ENTERED: a name beginning "=" must land as text.
        // Row counts are recorded once the write lands, or a failed shorter
        // write would leave the next one padding too little.
        await call(
          config,
          token,
          `${config.spreadsheetId}/values:batchUpdate`,
          {
            method: "POST",
            body: {
              valueInputOption: "RAW",
              data: group.map(({ tab, values }) => ({
                range: rangeOf(tab),
                values: padTo(values, extent.get(tab) ?? 0),
              })),
            },
          },
        );
        for (const { tab, values } of group) extent.set(tab, values.length);
      }
    },
  };
}
