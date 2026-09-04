# Entry Scheduler

A walk-up help queue. Visitors check themselves in at a shared screen; staff
work the line, record what happened, and export the day as a spreadsheet.

Visitors give **name, date of birth, phone, and gender** — only the name is
required. Everything else on the sign-in log (case type, appointment and legal
outcomes, time spent) is filled in by staff.

Statuses are **new** → **pending** (someone is helping) → **resolved** (helped).

## The queue

Walk-ins and appointments share one line. Position is decided by two things:

1. **Triage level** — emergency, then urgent, then routine. Staff set it; it is
   never shown to visitors, only reflected in the order. Visitors cannot set
   their own, or everyone would be an emergency.
2. **Time due** — your appointment time if you have one, otherwise when you
   signed in. A 2pm booking falls in behind the morning walk-ins and ahead of
   anyone who arrives after 2pm.

An appointment that is not due yet waits at the back **whatever its triage
level**, so the board never announces someone who has not arrived as next up.
It takes its rightful place the moment its time comes.

The server sends a `due` flag with every entry rather than letting each screen
work it out, so the board, the console, and the ordering can never disagree.
The console splits on it — **Waiting** and **Scheduled later** — while the
ordering underneath stays one line.

## The visitor screen

<http://localhost:5173> — meant for a tablet or kiosk in the waiting room, and
usable from a visitor's own phone.

**Checking in.** One card: name (required), date of birth, phone, and gender —
a four-option list (Male, Female, Non-binary, Other) plus "Prefer not to say".
The screen never asks what the legal issue is; staff add that later.

**The board.** Above the form, **Now being helped** lists the numbers currently
with staff, and **Up next** shows the lowest waiting number. Numbers only — a
screen the whole room can see never names who is mid-conversation.

**Your ticket.** After checking in, the form is replaced by that person's
number, their name, and their place in line — "2 people ahead of you", "You're
next!", or "Someone is helping you now". An appointment that has not come due
says so instead of counting people. The ticket is remembered in `localStorage`,
so a reload or a locked phone comes back to it.

**Check someone else in** clears that device and opens the check-in form
straight away, ready for the next person. It does not remove anyone from the
queue — only staff can do that.

**Currently waiting** lists everyone in line as a number, a shortened name
("Ada L."), and a status. The shortening happens on the server, so the only
full name this screen ever holds is the reader's own.

## The staff console

<http://localhost:5173/#/admin> — staff sign in with their own Google account
where that is configured, otherwise with one shared passcode held in
`sessionStorage` for that tab. See [Who may use the console](#who-may-use-the-console).
Either way the console is refused outright from outside the local network
unless `ALLOW_REMOTE_ADMIN=true`.

**Helping as** — the name recorded against everyone you help. With Google
sign-in it is simply whoever is signed in, taken from their Google account and
not editable: a console passed from one person to the next cannot credit one
for the other's work. Where Google sends no display name — an account that has
none set — the box comes back, rather than signing the work with an email
address. On a passcode deployment there is no identity behind the shared
credential, so the name is typed there and kept on that device.

Four tabs, all sharing the single queue order (arrow keys move between them):

| Tab                 | Holds                                   |
| ------------------- | --------------------------------------- |
| **Waiting**         | Walk-ins and appointments that are due  |
| **Being helped**    | Whoever staff are with right now        |
| **Scheduled later** | Appointments whose time has not arrived |
| **Done**            | Everyone already helped                 |

Each row carries the number, full name, case type, a triage dropdown, how long
they have been waiting, who helped, and three actions:

- **Start helping** → **Mark helped** → **Reopen** — one button that walks the
  status forward, and back if someone was closed by mistake.
- **Edit** opens the row editor.
- **Remove** deletes the entry, behind a confirmation.

**The row editor** is where the rest of the sign-in log gets filled in: date of
birth, phone, gender, case type, who helped, appointment time, triage level,
appointment type, appointment outcome, legal outcome, time spent in quarter
hours, and a staff-only admin note. Its draft is seeded once when it opens, so
the 5-second poll cannot overwrite half-typed changes.

**Header actions** — **Book someone in** (a form for a walk-up who cannot work
the screen, or for an appointment: leave the time blank for a walk-up),
**Open spreadsheet** (owners only, and only where Sheets is configured),
**Download spreadsheet**, **Staff access** (owners only — a button that opens
and closes the access list), and **Sign out**, which asks first: on a shared
console, signing out means finding whoever was signed in to get back in. Beside the queue tabs, owners
also get **Sync List**, which copies the board into a tab per month it spans
without taking anything off it.
Months are filed away on their own — see [Month tabs](#month-tabs) — so this is
only for taking a record early.

A banner warns when failed sign-in attempts pile up, so staff can see someone
guessing at the passcode. If the server stops accepting the session — a
restart with a different passcode, say — the console drops back to the sign-in
form rather than retrying, which would spend the rate-limit budget and lock
staff out of signing back in.

## Development

Node 20.12 or newer (the dev server uses `--env-file-if-exists`).

```bash
cp .env.example .env      # then set ADMIN_PASSCODE and GOOGLE_SHEETS_ID
npm run boot              # installs dependencies, then starts both servers
```

`npm run boot` is the one command from a fresh clone. Day to day, `npm run dev`
does the same without re-checking dependencies.

`npm run dev` runs both halves together: the API on **:3001** and Vite on
**:5173**, with `/api` proxied across so there is one URL to open.

- Visitors: <http://localhost:5173>
- Staff: <http://localhost:5173/#/admin>

The server refuses to start when its configuration would be unsafe or useless:

- without `GOOGLE_SHEETS_ID`, since that spreadsheet *is* the database;
- without `ADMIN_PASSCODE` — or with one under 12 characters — **unless**
  Google sign-in is configured, in which case the passcode is neither needed
  nor read;
- with `SESSION_SECRET` shorter than 32 characters, because that key signs the
  staff session cookie;
- with `ALLOW_REMOTE_ADMIN=true` but no Google sign-in configured, which would
  leave one shared passcode guarding a console open to the internet.

To run a throwaway instance without touching your real queue, point it at a
scratch spreadsheet:

```bash
ADMIN_PASSCODE=scratch-passcode-123 GOOGLE_SHEETS_ID=some-other-sheet npm run dev
```

To let people join from their phones, run Vite with `--host` and share the
network URL it prints.

Before opening a change: `npm test`, `npm run typecheck`, and `npm run lint`
(`npm run lint:fix` applies what Biome can fix on its own).

## Deploying

In development Vite serves the UI and proxies the API. In production the Node
server serves both from **one port**, so there is a single process to deploy.

```bash
npm run build     # builds the frontend to dist/ and compiles the server to dist-server/
npm start         # node dist-server/index.js — no tsx, no dev dependencies
```

There is also a `Dockerfile` — a multi-stage build that ships only `dist/`,
`dist-server/` and production dependencies, and runs as an unprivileged user.
It starts `node` directly rather than `npm start`, so the server receives
`SIGTERM` itself and can finish an in-flight write before the container stops.

```bash
docker build -t entry-scheduler .
docker run -p 8080:8080 --env-file .env entry-scheduler   # see the note below
```

`--env-file` cannot carry a multi-line value, so a `GOOGLE_SA_KEY` in the file
arrives empty. Pass that one with `-e GOOGLE_SA_KEY="$GOOGLE_SA_KEY"`, or run
without a key and let the host's own service account authenticate.

Set these on the host:

| Variable         | Notes                                                    |
| ---------------- | -------------------------------------------------------- |
| `ADMIN_PASSCODE` | Required unless Google sign-in is configured, and at least 12 characters. |
| `PORT`           | Most hosts set this for you; defaults to 3001.           |
| `GOOGLE_SHEETS_ID` | Required. The queue is stored here; the id from the sheet URL. |
| `GOOGLE_SHEETS_TAB` | Optional. Tab to write, defaults to `Sheet1`, the name Google gives the first tab of a new spreadsheet. |
| `GOOGLE_STAFF_TAB` | Optional. Tab holding the staff list, defaults to `Staff`. |
| `GOOGLE_STAFF_SHEETS_ID` | Optional. Keeps the staff list in its own spreadsheet, shared only with owners. Defaults to the queue's spreadsheet, where anyone who can open the file can read it. |
| `TZ`             | The clinic's zone, e.g. `America/Los_Angeles`. Months are cut in local time, and a host left on UTC files a late evening into the next month. |
| `GOOGLE_OAUTH_CLIENT_ID` | Turns on Google sign-in for staff. With it set, the passcode is no longer accepted. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From the same OAuth client. |
| `SESSION_SECRET` | Signs the staff session cookie. At least 32 random characters. |
| `ADMIN_EMAILS` | Owners who can never be locked out, comma-separated. |
| `OAUTH_REDIRECT_URI` | Optional. Defaults to `<this host>/api/auth/callback`. |
| `TRUST_PROXY` | Number of proxy hops to trust, e.g. `1` on Cloud Run. Leave unset anywhere the port is reachable directly. |
| `ALLOW_REMOTE_ADMIN` | `true` opens the console to any address. Requires Google sign-in; the server refuses to start otherwise. |
| `GOOGLE_SA_EMAIL` | Only when using a downloaded key. Service account `client_email`. |
| `GOOGLE_SA_KEY`  | Only when using a downloaded key. `private_key`, newlines as `\n`. |

Build command `npm run build`, start command `npm start`.

There is no local database and nothing to mount: the queue lives entirely in
the spreadsheet, so an ephemeral filesystem costs nothing.

## Running on Cloud Run

Nothing needs restructuring — the container listens on `$PORT` and serves the
API and the frontend together. Four settings matter:

- **`--max-instances=1`.** Every write rewrites the whole tab, and the write
  queue that keeps those from colliding lives in one process's memory. Two
  instances would overwrite each other with nothing in the Sheets API to stop
  them. The work is waiting on Google, not on CPU, so one instance with high
  concurrency is the right shape.
- **`TRUST_PROXY=1`.** Without it the app sees Google's front end as the client
  — a private address — and cannot tell visitors apart. It refuses to treat a
  forwarded request as on-network in that state, so the console would reject
  everyone rather than admit everyone.
- **`ALLOW_REMOTE_ADMIN=true`**, since no real client is on the local network.
  The server refuses to start in that state unless Google sign-in is
  configured, so the console cannot end up guarded by a shared passcode alone.
- **Credentials from the attached service account.** Grant the runtime service
  account the Sheets scope and share the spreadsheet with its address; leave
  `GOOGLE_SA_EMAIL` and `GOOGLE_SA_KEY` unset. Put `ADMIN_PASSCODE` (if you
  still use one) and `SESSION_SECRET` in Secret Manager.

The deploy itself, from a clone — Cloud Build picks up the `Dockerfile`:

```bash
gcloud run deploy SERVICE --source . --region REGION \
  --max-instances=1 --allow-unauthenticated \
  --service-account=SA@PROJECT.iam.gserviceaccount.com \
  --set-env-vars TRUST_PROXY=1,ALLOW_REMOTE_ADMIN=true,GOOGLE_SHEETS_ID=SHEET_ID,GOOGLE_OAUTH_CLIENT_ID=CLIENT_ID \
  --set-secrets SESSION_SECRET=session-secret:latest,GOOGLE_OAUTH_CLIENT_SECRET=oauth-client-secret:latest
```

`--allow-unauthenticated` is about IAM, not the console: visitors have no
Google Cloud account, and the console does its own sign-in behind it.

`ADMIN_EMAILS` is left out on purpose. `--set-env-vars` splits on commas, so a
list of owners would be read as several variables and the deploy would fail.
Pass it with its own delimiter instead:

```bash
gcloud run services update SERVICE --region REGION \
  --update-env-vars "^:^ADMIN_EMAILS=first@example.org,second@example.org"
```

`--update-env-vars`, not `--set-env-vars`: on a service that already exists the
latter replaces the whole environment, taking `TRUST_PROXY` and the rest with
it.

Two things live outside the command. Create the secrets once
(`printf %s "$(openssl rand -base64 32)" | gcloud secrets create session-secret --data-file=-`)
and grant the runtime service account `roles/secretmanager.secretAccessor` on
each. Then, once the service has its URL, add
`https://SERVICE-HASH.REGION.run.app/api/auth/callback` to the OAuth client's
authorised redirect URIs — sign-in fails with `redirect_uri_mismatch` until it
is there, and the URL is only known after the first deploy.

Verify a write against a scratch spreadsheet before the real cutover: the
metadata server issues `cloud-platform`-scoped tokens, and Sheets does not
document that scope as accepted. If it is refused, fall back to a downloaded
key in `GOOGLE_SA_KEY`.

## Who may use the console

By default the console is behind one shared passcode. Set the four
`GOOGLE_OAUTH_*` / `SESSION_SECRET` / `ADMIN_EMAILS` variables and staff sign in
with their own Google account instead; the passcode stops being accepted the
moment those are present.

Access has two levels:

- **Staff** work the queue.
- **Owners** do that and can change who has access, from the "Staff access"
  panel in the console.

`ADMIN_EMAILS` names owners in the environment. They are always owners and
cannot be removed through the console, so a mistake in the list can never lock
everyone out. Everyone else lives in the `Staff` tab of the same spreadsheet,
which the app creates on first use.

Managing access is deliberately unavailable on a passcode-only deployment:
everybody there shares one credential, so there is no "certain staff" to trust
with it.

Setting it up:

1. In Google Cloud, configure the **OAuth consent screen** (Internal, if this
   is a Workspace org).
2. Create an **OAuth client ID** of type *Web application*.
3. Add `<your host>/api/auth/callback` as an authorised redirect URI — for
   local work that is `http://localhost:3001/api/auth/callback`.
4. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, a long random
   `SESSION_SECRET`, and `ADMIN_EMAILS`.

Sign-in asks for `openid`, `email` and `profile`. The last of those is what
carries the display name the console credits work to; without it Google sends
only an address, and the sign-in log reads as a column of email addresses.

Sessions last 12 hours and live in an HttpOnly, SameSite=Lax cookie; nothing is
stored on the device. The name travels in that cookie, so anyone already signed
in shows as their email address until their next sign-in.

## The spreadsheet is the database

One tab holds the queue. The human columns of the sign-in log come first —
with the log's single **Notes** column split into **Notes** (the visitor's) and
**Staff Notes**, since the console has to tell them apart — then the
bookkeeping the log has no room for: **ID**, **Status**, **Signed In**, **Last
Changed**, **Helped By**, **Priority**, **Appointment Time**. A row is a whole
entry.

**Signed In**, **Last Changed** and **Appointment Time** are written as a plain
`2026-09-03 14:15:32` in the host's zone rather than as an ISO timestamp, so
the tab reads like a log. They are still read back to the second, and an ISO
value typed in by hand is accepted too.

Columns are read back by header name, and the headers they used to go by
(`id`, `createdAt`, `adminNote` and the rest) are still accepted, so a
spreadsheet written by an older version keeps working; the next write renames
them in place.

Because it is the store rather than a copy, editing the tab edits the queue —
but only in the cells the app reads back. Every change rewrites the whole tab
in the app's own column order, so anything else you type there is overwritten
by the next check-in or save. Specifically:

- **Kept:** edits to a value column the app reads — a name, a phone number, a
  case type, **Status**, **Priority**, **Appointment Time**, either notes
  column, and so on.
- **Overwritten:** a column you add yourself, anywhere in the tab.
- **Overwritten:** the **Date** column, which is derived from **Signed In** and
  so is never read back.

Rows without a numeric **ID** are ignored, so a note typed into a spare row is
harmless. A hand-edited **Status** or **Priority** that is not a recognised value
falls back to `new` / `routine` rather than breaking the board.

Two consequences worth knowing:

- **The board is rewritten in full on every change.** A column added by hand
  is overwritten; the month tabs are where finished work is kept.
- Reads are cached for five seconds. An edit made directly in Google Sheets
  shows up in the console within that, not instantly.

Setting it up:

1. In Google Cloud, enable the **Google Sheets API** for the project.
2. Create a **service account**.
3. **Share the spreadsheet with the service account's address, as an Editor.**
   A service account is its own identity, not you — without this every write
   comes back `403`.
4. Set `GOOGLE_SHEETS_ID` (and `GOOGLE_SHEETS_TAB` if the tab is not
   `Sheet1`). Without an id the button reports the feature as
   unconfigured and nothing is sent.
5. Give the server a way to authenticate as that account, either:
   - **attached identity, no key** — deploy on a host running as the service
     account (Cloud Run's `--service-account`), and leave `GOOGLE_SA_EMAIL`
     and `GOOGLE_SA_KEY` unset. Nothing to leak, and it is the only option
     when the organisation enforces
     `constraints/iam.disableServiceAccountKeyCreation`; or
   - **downloaded key** — set `GOOGLE_SA_EMAIL` and `GOOGLE_SA_KEY` from a
     service-account JSON key.

The push is `valueInputOption=RAW`, so a name beginning `=` lands as text
rather than being evaluated as a formula.

Note that this sends client names, dates of birth, phone numbers and case
details to Google. The admin API otherwise refuses non-local callers, so this
is the one path that takes intake data off site — worth checking against the
clinic's confidentiality policy before switching it on.

Two other things to get right before real use:

- **Serve over HTTPS.** On a passcode deployment the credential travels as a
  plaintext header; with Google sign-in the session cookie does. Either way,
  plain HTTP hands it to anyone on the network path. Every managed host
  terminates TLS for you; just don't skip it.
- **Prefer Google sign-in to the shared passcode.** Once deployed the URL is
  publicly reachable, and a passcode is one secret shared by everyone with no
  way to revoke one person. Failed admin requests are rate limited — 30 per 15
  minutes per address, successful ones not counted — but that only slows
  guessing down.
- **Set `TRUST_PROXY` when, and only when, something terminates in front of
  you.** Behind a proxy the app otherwise sees the proxy's own private address
  as the client and cannot tell visitors apart, which both defeats the
  local-network rule and collapses the rate limits onto a single key. A request
  arriving with an `X-Forwarded-For` header the app was not told to trust is
  treated as off-network rather than guessed about.

### Keeping the access list to owners

The **Staff access** panel in the console opens only for owners, and the server
enforces it — but the list itself lives in the spreadsheet, and Google Sheets has no way
to keep one tab from someone who can open the file. A protected range stops
*edits*, not reads, and a hidden sheet is unhidden from a menu.

So if staff can open the queue spreadsheet at all, they can read who has
access. To keep it to owners, put the list in a spreadsheet of its own:

1. Create a second spreadsheet, shared only with the owners **and the service
   account, as an Editor**.
2. Set `GOOGLE_STAFF_SHEETS_ID` to its id. `GOOGLE_STAFF_TAB` still names the
   tab within it, and the app creates that tab on first write.

The server logs a warning at startup while the two share a file, so a
deployment cannot quietly stay that way by accident.

Whichever file it lives in, protecting the tab is still worth doing: it stops a
staff member with edit access from writing themselves an `owner` row. In Google
Sheets, right-click the tab → **Protect sheet**, and leave only the service
account able to edit.

## Month tabs

The board is the working queue, not the archive. Each month it spans is kept
in its own tab named for it — "September 2026". The live log stays the first
tab of the spreadsheet; a month is filed into a tab directly after it, so the
newest month sits next to the log and older ones shift further right.

Two things write those tabs:

- **By itself.** On the first change of a new month the whole board is copied
  into its month tabs, and the finished entries from months that have ended
  come off the board. Nobody has to remember to close a month out.
- **Sync List**, beside the queue tabs, does the copying early. It
  takes nothing off the board — whatever month it is — and never makes a second
  tab for a month it has already written. It also writes the board back to its
  own tab, which renames any headers left by an older version.

Anything still open stays on the board however old it is, so an appointment
booked for next month is never filed away from under the person waiting on it.
An entry keeps the month it was taken in, so a case carried over is written to
its own month rather than the current one, and a tab keeps rows the board no
longer has: saving again merges rather than replacing, matching on the entry
number together with its sign-in time, since numbering used to restart and one
month can hold two different people as #3.

Months are cut in the server's local time, so set `TZ` to the clinic's zone.
On a host left at UTC an entry taken on the evening of the 31st is filed a
month ahead of when it was really taken.

## Who can do what

Permissions are enforced on the server, not just hidden in the UI — the admin
routes reject any request without a valid staff session (a Google sign-in
cookie, or the `x-admin-passcode` header where the passcode is still in use),
so a visitor cannot change a status or pull the export by calling the API
directly.

| Action                                    | Visitor | Staff | Owner |
| ----------------------------------------- | ------- | ----- | ----- |
| Check in with a name                      | ✅      | ✅    | ✅    |
| Give DOB, phone, gender                   | ✅      | ✅    | ✅    |
| Set the case type                         | ❌      | ✅    | ✅    |
| Book someone in / set an appointment      | ❌      | ✅    | ✅    |
| Set a triage level                        | ❌      | ✅    | ✅    |
| Record appointment / legal outcome        | ❌      | ✅    | ✅    |
| See who is waiting (short names + status) | ✅      | ✅    | ✅    |
| See full names                            | ❌      | ✅    | ✅    |
| Change a status / flag as helped          | ❌      | ✅    | ✅    |
| Write or read notes                       | ❌      | ✅    | ✅    |
| See timestamps and who helped             | ❌      | ✅    | ✅    |
| Export CSV                                | ❌      | ✅    | ✅    |
| Remove an entry                           | ❌      | ✅    | ✅    |
| Sync the board to its month tabs          | ❌      | ❌    | ✅    |
| Open the spreadsheet itself               | ❌      | ❌    | ✅    |
| See the failed sign-in warning            | ❌      | ❌    | ✅    |
| Grant or revoke console access            | ❌      | ❌    | ✅    |

The owner column applies only where Google sign-in is configured. On a
passcode deployment everyone who has the passcode is "staff", and managing
access is switched off entirely — there is no per-person identity to trust
with it.

Nobody can take themselves out of the line: a visitor who leaves is removed by
staff, so the log still records that they came in.

## CSV export

The **Download spreadsheet** button downloads `entries-YYYY-MM-DD.csv` laid out
as the **SIGN IN LOG SPREADSHEET** tab of `docs/Legal Triage Ticketing System.xlsx`, so
a day's rows paste straight in:

```csv
Date,Client Name,DOB,Gender,Phone #,Case Type,Appointment Type,Appointment Outcome,Notes,Legal Outcome,Time (0.25 increments)
"2026-08-05","Ada Lovelace","1990-04-02","Female","503-555-0142","Housing/Eviction","Clinic","Completed","eviction notice","REFERRAL MADE","1.25"
```

Case Type, Appointment Type, Appointment Outcome, and Legal Outcome are the
controlled vocabularies from that workbook's **CARE4 CODES** tab, mirrored in
`server/shared/codes.ts` — the one place to edit if the workbook changes, alongside
the gender options. Notes holds the note typed when booking someone in and the
admin note, in that order.

Fields not in the log (id, status, who helped, timestamps) stay in the admin
console and the API; they are deliberately left out of the export.

Opens directly in Excel, Numbers, or Google Sheets. Cells starting with `=`, `+`,
`-`, or `@` are prefixed with `'` so spreadsheets treat them as text rather than
formulas.

## Scripts

| Command             | Does                                          |
| ------------------- | --------------------------------------------- |
| `npm run boot`      | `npm install`, then `npm run dev`             |
| `npm run dev`       | API (:3001) and web UI (:5173) together       |
| `npm test`          | Vitest suite                                  |
| `npm run typecheck` | TypeScript, no emit                           |
| `npm run lint`      | Biome check (`lint:fix` to apply fixes)       |
| `npm run format`    | Biome formatter                               |
| `npm run build`     | Frontend to `dist/`, server to `dist-server/` |
| `npm start`         | Run the production build on one port          |

## Notes and limits

- Data lives in the Google Sheet named by `GOOGLE_SHEETS_ID`; there is no
  local database. If Google is unreachable, so is the queue.
- **Sign out** clears the staff session for that tab. With Google sign-in an
  owner can revoke one person from the Staff access panel — behind a
  confirmation, since it locks them out mid-shift — and it takes effect within
  about 30 seconds. With the shared passcode there is nothing to revoke
  per person: change `ADMIN_PASSCODE` and restart, which locks out everyone.
- "Helped by" is the signed-in identity where Google sign-in is on, and a name
  typed on the device where it is not.
- Both screens poll every 5 seconds rather than using websockets.
- Serve over HTTPS before using this anywhere beyond a trusted local network —
  the passcode is sent as a plain header.
