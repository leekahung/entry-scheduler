import { GoogleAuth } from "google-auth-library";
import {
  accessToken,
  type GetToken,
  type SheetsConfig,
  sheetProperties,
} from "./client.js";

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
  getToken: GetToken,
): Promise<number | undefined> {
  try {
    const sheets = await sheetProperties(config, await getToken(config));
    return sheets.find(({ title }) => title === config.tab)?.sheetId;
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
  getToken: GetToken = accessToken,
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
