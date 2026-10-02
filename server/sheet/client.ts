import { GoogleAuth, JWT } from "google-auth-library";

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

/** Issues an access token; injectable so tests need no real one. */
export type GetToken = (config: SheetsConfig) => Promise<string>;

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

export async function accessToken(config: SheetsConfig): Promise<string> {
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

export async function call(
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

/** A1 notation needs the tab name single-quoted, with internal quotes doubled. */
export const rangeOf = (tab: string) => `'${tab.replace(/'/g, "''")}'!A1:Z`;

/**
 * `values` padded with blank rows down to `held`, the rows the tab last held.
 * Never clear-then-write: blanking the old tail in the same write is safer.
 */
export function padTo(
  values: (string | number)[][],
  held: number,
): (string | number)[][] {
  if (values.length >= held) return values;
  const blank = Array<string>(values[0]?.length ?? 0).fill("");
  return [
    ...values,
    ...Array.from({ length: held - values.length }, () => [...blank]),
  ];
}

/**
 * Adds tabs in one call, at `index` if given, else after the rest.
 * Resolves false when one already exists: a batch fails whole, so which of
 * them now exist is unknown.
 */
export async function addSheets(
  config: SheetsConfig,
  token: string,
  titles: string[],
  index?: number,
): Promise<boolean> {
  try {
    await call(config, token, `${config.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: {
        requests: titles.map((title) => ({
          addSheet: {
            properties: index === undefined ? { title } : { title, index },
          },
        })),
      },
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already exists")) throw error;
    return false;
  }
}

/** Every tab's id and title, in the order the spreadsheet holds them. */
export async function sheetProperties(
  config: SheetsConfig,
  token: string,
): Promise<{ sheetId?: number; title?: string }[]> {
  const res = await call(
    config,
    token,
    `${config.spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { method: "GET" },
  );
  const body = (await res.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };
  return (body.sheets ?? []).map((sheet) => sheet.properties ?? {});
}
