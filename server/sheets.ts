import { GoogleAuth, JWT } from "google-auth-library";
import { toRows } from "./csv.js";
import type { Entry } from "./db.js";

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
    tab: env.GOOGLE_SHEETS_TAB?.trim() || "Sign In Log",
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

async function accessToken(config: SheetsConfig): Promise<string> {
  if (!config.credentials) {
    // No key: authenticate as the identity the host runs as, which on Cloud
    // Run is the service account attached to the service.
    const client = await new GoogleAuth({ scopes: SCOPES }).getClient();
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error(
        "No Google credentials available. Attach a service account to this host, or set GOOGLE_SA_EMAIL and GOOGLE_SA_KEY.",
      );
    }
    return token;
  }
  const auth = new JWT({
    email: config.credentials.clientEmail,
    key: config.credentials.privateKey,
    scopes: SCOPES,
  });
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error("Google refused the service-account key.");
  return token;
}

async function call(
  config: SheetsConfig,
  token: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const res = await fetch(`${API}/${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    // 403 here almost always means the sheet was never shared with the
    // service account, which reads like an auth failure but is not.
    throw new Error(
      res.status === 403
        ? `Google rejected the write (403). Share the spreadsheet with ${config.credentials?.clientEmail ?? "this host's service account"} as an Editor.`
        : `Google Sheets error ${res.status}: ${detail.slice(0, 200)}`,
    );
  }
  return res;
}

type SheetRequest = { path: string; method: string; body?: unknown };

/**
 * The two calls a sync makes, as data so they can be checked without a
 * network or a service-account key.
 */
export function sheetRequests(
  config: SheetsConfig,
  entries: Entry[],
): { requests: SheetRequest[]; rows: number } {
  const values = toRows(entries);
  const range = encodeURIComponent(`${config.tab}!A1:Z`);
  return {
    requests: [
      { path: `${config.spreadsheetId}/values/${range}:clear`, method: "POST" },
      {
        // RAW, never USER_ENTERED: a name beginning "=" must land as text,
        // not as a formula for the spreadsheet to evaluate.
        path: `${config.spreadsheetId}/values/${range}?valueInputOption=RAW`,
        method: "PUT",
        body: { values },
      },
    ],
    // The header is not one of the entries.
    rows: values.length - 1,
  };
}

/**
 * Replaces the tab's contents with the whole log.
 * A full rewrite rather than an append: syncing twice then leaves one copy of
 * each entry, and removals disappear from the sheet the way they do from the
 * console.
 */
export async function pushToSheet(
  config: SheetsConfig,
  entries: Entry[],
): Promise<{ rows: number }> {
  const token = await accessToken(config);
  const { requests, rows } = sheetRequests(config, entries);
  for (const request of requests) {
    await call(config, token, request.path, request);
  }
  return { rows };
}
