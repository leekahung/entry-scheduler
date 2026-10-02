import { GoogleAuth, JWT } from "google-auth-library";
import type { SheetTransport } from "./store.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetsConfig = {
  spreadsheetId: string;
  /** Tab name the log is written to. */
  tab: string;
  /**
   * A downloaded service-account key, or null to authenticate as whatever
   * identity the host already runs as. Organisations commonly forbid creating
   * keys at all, in which case the attached identity is the only way in.
   */
  credentials: { clientEmail: string; privateKey: string } | null;
};

/**
 * Reads the service-account settings from the environment.
 * Returns null when they are absent, which leaves the feature switched off
 * rather than failing every request.
 */
export function sheetsConfig(env = process.env): SheetsConfig | null {
  const spreadsheetId = env.GOOGLE_SHEETS_ID?.trim();
  if (!spreadsheetId) return null;
  const clientEmail = env.GOOGLE_SA_EMAIL?.trim();
  const privateKey = env.GOOGLE_SA_KEY?.trim();
  return {
    spreadsheetId,
    tab: env.GOOGLE_SHEETS_TAB?.trim() || "Sheet1",
    credentials:
      clientEmail && privateKey
        ? {
            clientEmail,
            // A key pasted into .env arrives with literal backslash-n rather
            // than real newlines, which the PEM parser rejects.
            privateKey: privateKey.replace(/\\n/g, "\n"),
          }
        : null,
  };
}

type TokenSource = { getAccessToken(): Promise<{ token?: string | null }> };

/**
 * One auth client per identity for the life of the process.
 * Building one costs ~2.7s, and it caches and refreshes its own token.
 */
const clients = new Map<string, Promise<TokenSource>>();

function authClient(config: SheetsConfig): Promise<TokenSource> {
  const key = config.credentials?.clientEmail ?? "default-credentials";
  let client = clients.get(key);
  if (!client) {
    client = config.credentials
      ? Promise.resolve(
          new JWT({
            email: config.credentials.clientEmail,
            key: config.credentials.privateKey,
            scopes: SCOPES,
          }),
        )
      : // No key: authenticate as the identity the host runs as, which on
        // Cloud Run is the service account attached to the service.
        new GoogleAuth({ scopes: SCOPES }).getClient();
    // A failed build must not be cached, or the process never recovers.
    client.catch(() => clients.delete(key));
    clients.set(key, client);
  }
  return client;
}

async function accessToken(config: SheetsConfig): Promise<string> {
  const { token } = await (await authClient(config)).getAccessToken();
  if (!token) {
    throw new Error(
      config.credentials
        ? "Google refused the service-account key."
        : "No Google credentials available. Attach a service account to this host, or set GOOGLE_SA_EMAIL and GOOGLE_SA_KEY.",
    );
  }
  return token;
}

/**
 * What Google says when it is busy rather than unhappy: the per-minute quota,
 * and the backend wobbles that clear on their own.
 */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
/** Retries after the first try, and the delay the first of them waits. */
export const RETRIES = 3;
const BACKOFF_MS = 250;
/** A call Google has not answered by now is abandoned and retried. */
export const SHEETS_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(
  config: SheetsConfig,
  token: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  // Retried, since a rate limit must not turn away a visitor; every request
  // here is a read or a whole-tab write, so safe to repeat.
  for (let attempt = 0; ; attempt++) {
    const retriable = attempt < RETRIES;
    let res: Response;
    // Writes run one at a time, so a hung call would stall every one queued.
    // Cleared once headers arrive: the body is read outside this retry loop.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SHEETS_TIMEOUT_MS);
    try {
      res = await fetch(`${API}/${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: abort.signal,
      });
    } catch (error) {
      // Dropped or timed out. Safe to repeat, though a timed-out write may
      // still land at Google later, after the retry.
      if (!retriable) throw error;
      await backOff(attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    if (retriable && TRANSIENT.has(res.status)) {
      // The body holds the socket until something reads it, and a burst of
      // rate limits is exactly when connections must not be left behind.
      await res.body?.cancel().catch(() => {});
      await backOff(attempt);
      continue;
    }

    const detail = await res.text();
    // 403 here almost always means the sheet was never shared with the
    // service account, which reads like an auth failure but is not.
    throw new Error(
      res.status === 403
        ? `Google rejected the write (403). Share the spreadsheet with ${config.credentials?.clientEmail ?? "this host's service account"} as an Editor.`
        : `Google Sheets error ${res.status}: ${detail.slice(0, 200)}`,
    );
  }
}

/**
 * Waits longer after each failure, and by a random amount: a whole waiting
 * room's polls fail together, and coming back together is what keeps a rate
 * limit tripped.
 */
function backOff(attempt: number): Promise<unknown> {
  return sleep(BACKOFF_MS * 2 ** attempt * (1 + Math.random()));
}

/**
 * Reads and writes the whole log tab over the Sheets API.
 * Never clear-then-write, which could leave the queue empty; a shorter log is
 * blanked by padding to the tab's previous extent.
 */
export function googleTransport(
  config: SheetsConfig,
  // Injectable so the request shape can be tested without Google issuing a
  // real token.
  getToken: (config: SheetsConfig) => Promise<string> = accessToken,
  // Only for tabs the app owns, such as the staff list. Never the log: a typo
  // must fail loudly, not read an empty new tab as an empty queue.
  { createMissing = false }: { createMissing?: boolean } = {},
): SheetTransport {
  // A1 notation needs the sheet name single-quoted, or a tab called
  // "Sign In Log" is rejected as an unparseable range. Internal quotes double.
  const range = encodeURIComponent(`'${config.tab.replace(/'/g, "''")}'!A1:Z`);
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
      const width = rows[0]?.length ?? 0;
      const blank = Array<string>(width).fill("");
      const padded = [
        ...rows,
        ...Array.from({ length: Math.max(extent - rows.length, 0) }, () => [
          ...blank,
        ]),
      ];
      // RAW, never USER_ENTERED: a name beginning "=" must land as text, not
      // as a formula for the spreadsheet to evaluate.
      await call(config, token, `${values}?valueInputOption=RAW`, {
        method: "PUT",
        body: { values: padded },
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
  try {
    await call(config, token, `${config.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: {
        requests: [{ addSheet: { properties: { title: config.tab } } }],
      },
    });
  } catch (error) {
    // Already there is the normal case, and the only one worth swallowing.
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) throw error;
  }
  created.add(key);
}

/**
 * Every tab in the spreadsheet, in the order it holds them.
 * The export needs this to find the months already filed away: those are tabs
 * of their own and no longer on the board.
 */
export async function listTabs(
  config: SheetsConfig,
  getToken: (config: SheetsConfig) => Promise<string> = accessToken,
): Promise<string[]> {
  const token = await getToken(config);
  const res = await call(
    config,
    token,
    `${config.spreadsheetId}?fields=sheets.properties.title`,
    { method: "GET" },
  );
  const body = (await res.json()) as {
    sheets?: { properties?: { title?: string } }[];
  };
  return (body.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
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

/** A1 notation needs the tab name single-quoted, with internal quotes doubled. */
const rangeOf = (tab: string) => `'${tab.replace(/'/g, "''")}'!A1:Z`;

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
  getToken: (config: SheetsConfig) => Promise<string> = accessToken,
): TabStore {
  // Which tabs are known to exist, so filing the same month twice does not
  // ask Google to create it twice.
  const known = new Set<string>();
  // How many rows each tab was last seen holding. A write shorter than that
  // has to blank the difference, or the tail of what was there is left behind.
  const extent = new Map<string, number>();

  // A merge can come back shorter than the tab (rows without an id drop), so
  // blank the old tail rather than leave duplicates.
  const padded = (tab: string, values: (string | number)[][]) => {
    const held = extent.get(tab) ?? 0;
    extent.set(tab, values.length);
    if (values.length >= held) return values;
    const blank = Array<string>(values[0]?.length ?? 0).fill("");
    return [
      ...values,
      ...Array.from({ length: held - values.length }, () => [...blank]),
    ];
  };

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

      // Create every unseen tab in one call, at index 1 so the log stays first.
      const missing = writes
        .map(({ tab }) => tab)
        .filter((tab) => !known.has(tab));
      if (missing.length > 0) {
        try {
          await call(config, token, `${config.spreadsheetId}:batchUpdate`, {
            method: "POST",
            body: {
              requests: missing.map((title) => ({
                addSheet: { properties: { title, index: 1 } },
              })),
            },
          });
          // Only once the call lands: a batch fails whole, so a refusal says
          // nothing about which tabs now exist.
          for (const tab of missing) known.add(tab);
        } catch (error) {
          // "Already exists" is fine (the write copes); anything else throws.
          // Either way nothing is remembered as created.
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("already exists")) throw error;
        }
      }

      for (const group of chunked(writes, BATCH)) {
        // RAW, never USER_ENTERED: a name beginning "=" must land as text.
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
                values: padded(tab, values),
              })),
            },
          },
        );
      }
    },
  };
}

/**
 * Where the access list is kept: a spreadsheet of its own, never the queue's.
 * Null until GOOGLE_STAFF_SHEETS_ID names one, which leaves only the owners
 * set in the environment able to sign in.
 */
export function staffSheetsConfig(
  sheets: SheetsConfig,
  env = process.env,
): SheetsConfig | null {
  const spreadsheetId = env.GOOGLE_STAFF_SHEETS_ID?.trim();
  if (!spreadsheetId) return null;
  return {
    ...sheets,
    spreadsheetId,
    tab: env.GOOGLE_STAFF_TAB?.trim() || "Staff",
  };
}

/**
 * The address this server reaches Google as, for owners to share a new
 * spreadsheet with. Null where the host cannot say.
 */
export function serviceAccountEmail(
  config: SheetsConfig,
): Promise<string | null> {
  if (config.credentials) {
    return Promise.resolve(config.credentials.clientEmail);
  }
  // Asking the host takes seconds and its answer never changes while the
  // process runs, so it is asked once — unless it could not say.
  hostAccount ??= new GoogleAuth().getCredentials().then(
    ({ client_email }) => client_email ?? null,
    () => null,
  );
  const asked = hostAccount;
  void asked.then((email) => {
    if (email === null && hostAccount === asked) hostAccount = undefined;
  });
  return asked;
}

let hostAccount: Promise<string | null> | undefined;

/** The spreadsheet's web address, for staff to open, download or copy it. */
export function sheetUrl(config: SheetsConfig): string {
  return `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`;
}

/** How long a link waits on its tab's id before going out without one. */
export const TAB_LOOKUP_WAIT_MS = 2000;

// A tab keeps its id for life, so a found one is kept for the process. A
// lookup still running is shared; one that found nothing is asked again.
const tabIds = new Map<string, Promise<number | undefined>>();

async function lookUpTab(
  config: SheetsConfig,
  getToken: (config: SheetsConfig) => Promise<string>,
): Promise<number | undefined> {
  try {
    const token = await getToken(config);
    const res = await call(
      config,
      token,
      `${config.spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      { method: "GET" },
    );
    const body = (await res.json()) as {
      sheets?: { properties?: { sheetId?: number; title?: string } }[];
    };
    return body.sheets?.find((sheet) => sheet.properties?.title === config.tab)
      ?.properties?.sheetId;
  } catch (error) {
    console.warn(
      "Could not look up the tab to link to:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

/**
 * The spreadsheet's address opened on `config.tab` rather than whichever tab
 * was last looked at. Falls back to the file itself when the tab is missing,
 * or Google is slow to say: a link must never hold up a sign-in.
 */
export async function tabUrl(
  config: SheetsConfig,
  getToken: (config: SheetsConfig) => Promise<string> = accessToken,
): Promise<string> {
  const key = `${config.spreadsheetId}:${config.tab}`;
  let lookup = tabIds.get(key);
  if (!lookup) {
    lookup = lookUpTab(config, getToken);
    tabIds.set(key, lookup);
    void lookup.then((id) => {
      if (id === undefined) tabIds.delete(key);
    });
  }
  // A lookup that outlasts the wait carries on, so a later link has the id.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), TAB_LOOKUP_WAIT_MS);
  });
  const id = await Promise.race([lookup, waited]).finally(() =>
    clearTimeout(timer),
  );
  return id === undefined ? sheetUrl(config) : `${sheetUrl(config)}#gid=${id}`;
}
