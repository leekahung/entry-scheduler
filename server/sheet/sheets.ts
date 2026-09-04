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
 * One auth client per identity, kept for the life of the process.
 *
 * Building a fresh one per request cost about 2.7 seconds every time; the
 * client caches the token internally and refreshes it when it expires, so
 * reusing it makes all but the first call free.
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(
  config: SheetsConfig,
  token: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  // The spreadsheet is the only copy of the queue, so a rate limit or a
  // dropped connection must not become a visitor who could not check in.
  // Every request here is safe to repeat: a read, or a write of the whole tab.
  for (let attempt = 0; ; attempt++) {
    const retriable = attempt < RETRIES;
    let res: Response;
    try {
      res = await fetch(`${API}/${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch (error) {
      // Never reached Google at all — as transient as a 503, and as safe.
      if (!retriable) throw error;
      await backOff(attempt);
      continue;
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
 *
 * One request per write, never clear-then-write: a clear that lands while the
 * write does not would leave the queue's only storage empty. A shorter log is
 * blanked by padding the payload out to the tab's previous extent instead.
 */
export function googleTransport(
  config: SheetsConfig,
  // Injectable so the request shape can be tested without Google issuing a
  // real token.
  getToken: (config: SheetsConfig) => Promise<string> = accessToken,
  // Only for tabs the app owns and may create, such as the staff list. Never
  // for the log: a typo in the tab name must fail loudly rather than quietly
  // create an empty tab and read the queue as empty.
  {
    createMissing = false,
    atIndex,
  }: { createMissing?: boolean; atIndex?: number } = {},
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
      if (createMissing) await ensureTab(config, token, atIndex);
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
 * `atIndex` places it: month tabs go to the right of the live log, which keeps
 * its place as the first tab of the spreadsheet.
 */
async function ensureTab(
  config: SheetsConfig,
  token: string,
  atIndex?: number,
): Promise<void> {
  const key = `${config.spreadsheetId}:${config.tab}`;
  if (created.has(key)) return;
  try {
    await call(config, token, `${config.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: {
        requests: [
          { addSheet: { properties: { title: config.tab, index: atIndex } } },
        ],
      },
    });
  } catch (error) {
    // Already there is the normal case, and the only one worth swallowing.
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) throw error;
  }
  created.add(key);
}

/** The spreadsheet's web address, for staff to open, download or copy it. */
export function sheetUrl(config: SheetsConfig): string {
  return `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`;
}
