# Entry Scheduler

A walk-up help queue. Visitors check themselves in at a shared screen; staff
work the line, record what happened, and export the day as a spreadsheet.

Visitors give **name, date of birth, phone, and gender** — only the name is
required. Everything else on the sign-in log (case type, appointment and legal
outcomes, time spent) is filled in by staff.

Statuses are **new** → **pending** (someone is helping) → **resolved** (helped).

## The queue

Walk-ins and appointments share one line. Position is decided by **time due** —
your appointment time if you have one, otherwise when you signed in. A 2pm
booking falls in behind the morning walk-ins and ahead of anyone who arrives
after 2pm.

**Visit type** only separates two entries due at the very same moment, where
email, phone and remote go first. It is never shown to visitors, and visitors
cannot set their own. Ranking it above the time due instead would hold a
walk-in behind every remote entry, including ones raised after they arrived.

An appointment that is not due yet waits at the back **whatever its visit
type**, so the board never announces someone who has not arrived as next up.
It takes its rightful place the moment its time comes.

Both screens grow a **Top** button once the page has scrolled a little way,
since the queue runs well past one screen on a busy day. It sits in the corner
the toasts leave free, and a layer below them, so it can never cover a message
waiting to be dismissed.

The server sends a `due` flag with every entry rather than letting each screen
work it out, so the board, the console, and the ordering can never disagree.
The console splits on it — **Waiting** and **Scheduled later** — while the
ordering underneath stays one line.

## The visitor screen

<http://localhost:5173> — meant for a tablet or kiosk in the waiting room, and
usable from a visitor's own phone.

**Checking in.** One card: name (required), date of birth, phone, and gender —
a four-option list (Male, Female, Non-binary, Other) plus "Prefer not to say".
The screen never asks what the legal issue is; staff add that later. A US phone
number picks up its dashes as it is typed — `5035550142` becomes
`503-555-0142` — while anything that cannot be a US number, an extension or an
overseas number, is kept exactly as it was written rather than rewritten into a
different one.

**The board.** Above the form, **Now being helped** lists the numbers currently
with staff, and **Up next** shows the lowest waiting number. Numbers only — a
screen the whole room can see never names who is mid-conversation.

**Your ticket.** After checking in, the form is replaced by that person's
number, their name, and their place in line — "2 people ahead of you", "You're
next!", or "Someone is helping you now". An appointment that has not come due
says so instead of counting people. The ticket is remembered in `localStorage`,
so a reload or a locked phone comes back to it.

**When the visit ends** — staff mark them helped — the ticket is replaced by a
short "You're all set", and the device forgets which entry it was holding. It
names nobody: a kiosk shows whatever is on its screen to whoever walks up
next, and the ticket already did the identifying while it mattered. The message
is held in component state rather than `localStorage`, which is what keeps the
forgetting immediate: a reload lands on the start screen, and a staff mis-click
back to **Waiting** cannot draw the ticket back over the next person. It stays
until someone taps, since the start screen needs a tap either way — and backing
out of the form it opens clears it too, so nobody who never checked in is
thanked for coming in.

**Check someone else in** clears that device and opens the check-in form
straight away, ready for the next person. It does not remove anyone from the
queue — only staff can do that.

**If checking in fails** the form stays exactly as it was, filled in, and a
message says so at the top of the screen — see [Saying what
happened](#saying-what-happened). Nobody has to type their name a second time
because the network dropped.

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

Five tabs, all sharing the single queue order (arrow keys move between them):

| Tab                 | Holds                                     |
| ------------------- | ----------------------------------------- |
| **Waiting**         | Walk-ins and appointments that are due    |
| **Being helped**    | Whoever staff are with right now          |
| **Scheduled later** | Appointments whose time has not arrived   |
| **Done**            | Everyone already helped                   |
| **Removed**         | Taken off the board, newest first, and able to be put back |

Each row carries the number, full name, case type, a visit-type dropdown, how
long they have been waiting, who helped, and three actions:

- **Status** — a select holding Waiting, Being helped and Done. A select
  rather than a button that walks the three in a circle: a row goes wherever
  it belongs in one place, so correcting a misclick is the same control as
  making it rather than a second one beside the first.
- **Edit** opens the row editor.
- **Remove** takes the entry off the board, behind a confirmation. It is
  reversible: the row moves to the **Removed** tab, where **Put back** returns
  it and owners are offered the permanent erase.

**On a narrower screen** — under about 1220px, where the seven columns stop
fitting — the table becomes one card per entry. The card is a grid rather than
a stack: it takes as many columns of fields as it has room for, three on a wide
tablet and one on a phone, so a card is not mostly empty space beside a case
code or a select. The number and name read as its heading, and the buttons and
the open editor run the full width.

**Who gets the credit** follows from where the row came from, not from where it
lands. Moving one from *Being helped* back to *Waiting* drops the name in
"Helped by", because nobody helped them — it was started by mistake. Moving one
from *Done* back keeps the name: someone did do the work, and that column is
the log's record of who. Neither sends the name of whoever made the change, so
putting a row back in the queue cannot quietly re-credit it to them.

**The row editor** is where the rest of the sign-in log gets filled in: date of
birth, phone, gender, case type, who helped, appointment time, visit type,
appointment type, appointment outcome, legal outcome, time spent in quarter
hours, and a staff-only admin note. Its draft is seeded once when it opens, so
the 5-second poll cannot overwrite half-typed changes. Closing it — or the
booking form — with edits still in it asks first, since the draft is the only
copy of what was typed.

**Date of birth and phone number are required**, and the phone must be a whole
ten-digit US number. The editor is a real form, so the browser reports what is
missing in its own words rather than the Save button being greyed out; Save is
still held back while nothing has been touched, since the server refuses an
empty update. Every other field can be left blank and filled in later.

Fields are **tinted while they are still empty** — red for the two that have to
be filled in, amber for the rest — and the tint clears as soon as each one
has a value. Never colour alone: the two required fields are also marked
`required`, and a line under the heading says which they are. Time spent reads
"Still to record" until somebody enters hours, which is the nudge to fill it
in once a visit is done.

One consequence worth knowing: a row created before these rules — a visitor who
skipped their date of birth, or a number that is not a ten-digit US one —
cannot be saved until both are supplied. Staff opening such a row to record an
outcome will be asked for them first.

**Header actions** — **Book someone in** (a form for a walk-up who cannot work
the screen, or for an appointment: leave the time blank for a walk-up; it also
takes **Helped by**, since whoever books someone in usually knows who will see
them, and that is a different person from whoever is working the console),
**Open spreadsheet** (owners only, and only where Sheets is configured),
**Download current list**, **Download all months**, **Staff access** (owners only — a button that opens
and closes the access list), and **Sign out**, which asks first: on a shared
console, signing out means finding whoever was signed in to get back in. Beside the queue tabs, owners
also get **Sync this month** after the last queue tab, which copies the board into a tab per month it spans
without taking anything off it.
Months are filed away on their own — see [Month tabs](#month-tabs) — so this is
only for taking a record early.

Every action says how it went — see [Saying what
happened](#saying-what-happened).

A banner warns when failed sign-in attempts pile up, so staff can see someone
guessing at the passcode. If the server stops accepting the session — a
restart with a different passcode, say — the console drops back to the sign-in
form rather than retrying, which would spend the rate-limit budget and lock
staff out of signing back in.

## Saying what happened

Both screens report their own work the same way: a short message that clears
itself. Nothing a person does is silent, and nothing that fails is silent
either.

Where it appears differs, because the two screens are read differently. The
console puts them bottom left — away from the standing banners at the top, and
clear of the Actions column, where a toast in the other corner would cover the
selects and buttons staff are still clicking. The kiosk keeps them at the top
and centred: one narrow column read across a room, with no header furniture
beside it to cover, and a check-in confirmation is the message that most needs
to be seen.

- **While it runs** — "Saving #12…", "Checking you in…". Only if the request
  takes longer than 400ms: most land well inside that, and a "Saving…" that
  flashes for a tenth of a second reads as a glitch rather than as progress.
- **When it lands** — "Helping #12.", "You're checked in. You are #3.", "Synced
  August 2026 and September 2026." Gone after 3.5 seconds.
- **When it fails** — the message stays 7 seconds, twice as long: it carries
  more to read, and it is the one somebody may have looked away from. Either
  can be dismissed outright.

Failures are announced to a screen reader assertively and everything else
politely, through two live regions that are always in the document — a region
that appears along with its first message may not be announced at all.

On the console the messages sit top left, clear of the header's own buttons; on
the kiosk they are centred and larger, for a screen read across a room.

**What a failure says** depends on what went wrong, because "Something went
wrong" helps nobody:

| What happened | What it says |
| ------------- | ------------ |
| The server named the problem (400, 403, 429, 501) | its own words — "Name is required", "Only an owner can do that" |
| The server broke (500) | "The server couldn't save that. Nothing was changed." |
| The row is already gone (404) | "#12 is no longer on the board — someone else may have removed it." |
| The session ended (401) | "Your session has ended. Sign in again." |
| The server was never reached | "Can't reach the server. Nothing was saved." |

The 404 case is worth the special wording: two staff work one queue, so a row
being removed while somebody else is acting on it is ordinary, not a bug. The
500 case is the opposite — the server answers every one of them with
"Something went wrong", which tells a visitor nothing they did not already
know, so the console and the kiosk supply their own words there.

Standing state stays a banner rather than a message that clears: a server that
cannot be reached, a month left unclosed, someone guessing at the passcode.
Those are conditions, not events.

## Development

Node 20.15 or newer — the dev server uses `--env-file-if-exists`, and the
workbook export uses `zlib.crc32` to build its zip.

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
- in production (`NODE_ENV=production`, which both `npm start` and the
  Dockerfile set) without Google sign-in, whatever the passcode says: see
  [Who may use the console](#who-may-use-the-console);
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

**A pre-commit hook does the first of those for you.** `npm install` points
`core.hooksPath` at `.githooks/`, so a fresh clone picks it up without anyone
having to be told; there is no dependency behind it.

It **applies** the formatting and the lint rules Biome can fix, rather than
refusing the commit over them, and re-stages the result so the fix lands in the
commit being made. Only files already staged are touched — a fixer let loose on
the whole working tree would sweep unrelated edits into somebody's commit.

The typecheck and the suite have no fix mode, so those two do still stop the
commit. `git commit --no-verify` skips the lot, for the times you mean to.

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
| `NODE_ENV` | Set to `production` by both `npm start` and the Dockerfile. It is what makes the server refuse the shared passcode, so don't unset it on a deployment. |
| `ADMIN_PASSCODE` | Development only — refused in production. Required in dev unless Google sign-in is configured, and at least 12 characters. |
| `PORT`           | Most hosts set this for you; defaults to 3001.           |
| `GOOGLE_SHEETS_ID` | Required. The queue is stored here; the id from the sheet URL. |
| `GOOGLE_SHEETS_TAB` | Optional. Tab to write, defaults to `Sheet1`, the name Google gives the first tab of a new spreadsheet. |
| `GOOGLE_STAFF_TAB` | Optional. Tab holding the staff list, defaults to `Staff`. |
| `GOOGLE_STAFF_SHEETS_ID` | Optional. Keeps the staff list in its own spreadsheet, shared only with owners. Defaults to the queue's spreadsheet, where anyone who can open the file can read it. |
| `TZ`             | Optional. The clinic's zone, defaulting to `America/Los_Angeles`. Months and stamps are cut in local time, so a clinic in another zone sets this; a host that names none is pinned to Pacific rather than left on the container's UTC. |
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

**A deployment signs staff in with Google. There is no other way in.**

The shared passcode is a development convenience and nothing more. It is one
credential with no identity behind it, nothing to revoke per person, and it
travels as a plain header — so it is refused outright in production. Two locks,
either of which is enough:

- the server **will not start** with `NODE_ENV=production` unless Google
  sign-in is configured, so a deployment that lost its OAuth settings fails
  loudly rather than quietly dropping to a shared secret;
- `requireAdmin` **refuses the passcode** whenever `NODE_ENV=production`,
  whatever the header says, answering `501` rather than `401` — there is no
  passcode here to get right, so nothing invites another guess.

Both `npm start` and the Dockerfile set `NODE_ENV=production`, so this is on
wherever the app is actually deployed. Locally, `npm run dev` still takes the
passcode.

Set the four `GOOGLE_OAUTH_*` / `SESSION_SECRET` / `ADMIN_EMAILS` variables and
staff sign in with their own Google account; the passcode stops being accepted
the moment those are present, in any environment.

Access has two levels:

- **Staff** work the queue.
- **Owners** do that and can change who has access, from the "Staff access"
  panel in the console.

`ADMIN_EMAILS` names owners in the environment. They are always owners and
cannot be removed through the console, so a mistake in the list can never lock
everyone out. Everyone else lives in the `Staff` tab of the same spreadsheet,
which the app creates on first use.

Nobody can take their own access away, by either road: an owner cannot remove
their own row, and cannot re-add themselves as staff to the same end. Both are
refused by the server rather than only hidden in the console, since the last
owner to make that mistake would leave nobody able to undo it.

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
Changed**, **Helped By**, **Visit Type**, **Appointment Time**. A row is a whole
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
  case type, **Status**, **Visit Type**, **Appointment Time**, either notes
  column, and so on.
- **Overwritten:** a column you add yourself, anywhere in the tab.
- **Overwritten:** the **Date** column, which is derived from **Signed In** and
  so is never read back.

Rows without a numeric **ID** are ignored, so a note typed into a spare row is
harmless. A hand-edited **Status** or **Visit Type** that is not a recognised
value falls back to `new` / `in-person` rather than breaking the board.

**Upgrading a sheet written before visit types.** **Visit Type** replaced a
**Priority** column holding `emergency` / `urgent` / `routine`. Those values do
not map onto a visit type, so they are not read: every existing row comes back
as `in-person`, and the first write after deploying renames the column and
replaces its contents. Take a copy of the tab first if that history is worth
keeping.

Two consequences worth knowing:

- **The board is rewritten in full on every change.** A column added by hand
  is overwritten; the month tabs are where finished work is kept.
- **The month tabs are read and written in batches.** Google counts a batched
  call as one request against the per-minute quota however many ranges it
  carries, so filing a board that spans a year costs a handful of calls rather
  than one per month. A month tab that does not exist yet is never named in a
  batched read, since one unparseable range can fail the whole call; it is
  created and written instead.
- Reads are cached for five seconds. An edit made directly in Google Sheets
  shows up in the console within that, not instantly. Polls that arrive while
  a read is already on its way share it rather than each starting one, so a
  full waiting room costs the same quota as a single screen.
- A request Google refuses because it is busy — a rate limit, or a backend
  error — is retried a few times, waiting longer each time. Only the failures
  that will not clear on their own, such as a spreadsheet that was never
  shared, are reported straight away.

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

- **Serve over HTTPS.** The staff session cookie travels with every admin
  request, and plain HTTP hands it to anyone on the network path. Every managed
  host terminates TLS for you; just don't skip it.
- **Set `TRUST_PROXY` when, and only when, something terminates in front of
  you.** Behind a proxy the app otherwise sees the proxy's own private address
  as the client and cannot tell visitors apart, which both defeats the
  local-network rule and collapses the rate limits onto a single key. A request
  arriving with an `X-Forwarded-For` header the app was not told to trust is
  treated as off-network rather than guessed about.

### Keeping the access list to owners

Adding an address that is already listed rewrites its row, so the add form is
also how a role is changed — and how one is taken away. It asks first, naming
both roles, because answering like an ordinary add is no way to learn that an
owner has just been demoted. Doing it to yourself is called out separately: the
panel closes with the demotion and another owner has to put it back, which is
the same thing the **Remove** button already refuses to let anyone do to their
own access.

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
tab of the spreadsheet; a month closing on its own is filed into a tab directly
after it, so the newest month sits next to the log and older ones shift further
right. Several months filed in one go — a first sync of a board that spans a
year — are written side by side and land after the log in no particular order
among themselves.

Two things write those tabs:

- **By itself.** On the first change of a new month the whole board is copied
  into its month tabs, and the finished entries from months that have ended
  come off the board. Nobody has to remember to close a month out. The filing
  runs behind the change rather than in front of it, so the check-in that
  happens to be the month's first is answered at once and does not wait on a
  read and a write for every month the board spans. It shows up on the board a
  moment later.
- **Sync this month** — after the last queue tab, owners only — does the
  copying early. It follows the tabs rather than sitting by the page steps,
  where a circular arrow would read as one of them, and carries none of a
  button's furniture so it does not read as a fifth tab either. It keeps its
  words: an icon alone next to five labelled tabs is a guess. It takes nothing
  off the board — whatever month it is — and never makes a second
  tab for a month it has already written. It also writes the board back to its
  own tab, which renames any headers left by an older version.

Anything still open stays on the board however old it is, so an appointment
booked for next month is never filed away from under the person waiting on it.
An entry keeps the month it was taken in, so a case carried over is written to
its own month rather than the current one, and a tab keeps rows the board no
longer has: saving again merges rather than replacing, matching on the entry
number together with its sign-in time, since numbering used to restart and one
month can hold two different people as #3.

Months are cut in the server's local time. A container is on UTC unless it is
told otherwise, and an entry taken on the evening of the 31st would then be
filed a month ahead of when it was really taken — so the server pins itself to
`America/Los_Angeles` when nothing sets `TZ`. A clinic in another zone sets
`TZ`, which is honoured as it always was.

## Who can do what

Permissions are enforced on the server, not just hidden in the UI — the admin
routes reject any request without a valid staff session (a Google sign-in
cookie, or — in development only — the `x-admin-passcode` header), so a visitor
cannot change a status or pull the export by calling the API directly.

| Action                                    | Visitor | Staff | Owner |
| ----------------------------------------- | ------- | ----- | ----- |
| Check in with a name                      | ✅      | ✅    | ✅    |
| Give DOB, phone, gender                   | ✅      | ✅    | ✅    |
| Set the case type                         | ❌      | ✅    | ✅    |
| Book someone in / set an appointment      | ❌      | ✅    | ✅    |
| Set a visit type                          | ❌      | ✅    | ✅    |
| Record appointment / legal outcome        | ❌      | ✅    | ✅    |
| See who is waiting (short names + status) | ✅      | ✅    | ✅    |
| See full names                            | ❌      | ✅    | ✅    |
| Change a status / flag as helped          | ❌      | ✅    | ✅    |
| Write or read notes                       | ❌      | ✅    | ✅    |
| See timestamps and who helped             | ❌      | ✅    | ✅    |
| Download the current list                 | ❌      | ✅    | ✅    |
| Download all months                       | ❌      | ❌    | ✅    |
| Remove an entry (reversible)              | ❌      | ✅    | ✅    |
| Put a removed entry back                  | ❌      | ✅    | ✅    |
| Erase a removed entry for good            | ❌      | ❌    | ✅    |
| Sync the board to its month tabs          | ❌      | ❌    | ✅    |
| Open the spreadsheet itself               | ❌      | ❌    | ✅    |
| See the failed sign-in warning            | ❌      | ❌    | ✅    |
| Grant or revoke console access            | ❌      | ❌    | ✅    |

The owner column applies only where Google sign-in is configured. On a
passcode deployment everyone who has the passcode is "staff", and managing
access is switched off entirely — there is no per-person identity to trust
with it.

Nobody can take themselves out of the line: a visitor who leaves is removed by
staff. **Removing is reversible.** The row is not deleted — it is stamped with
the time in a `Removed At` column and stays exactly where it is. Every view
that describes the room filters it out: the public board, the queue tabs, the
counts in the header, and the exports. It appears in one place, the **Removed**
tab, where **Put back** clears the stamp and returns it to the board — for as
long as the row is on it. A row both removed and finished is filed away when
its month closes, like every other finished row, so removing is reversible for
the month it happened in rather than for good.

Every tab is read ten rows at a time, as is the visitor's waiting list. The
control says which rows are on screen and where in the list they fall — "11–20
of 34 · Page 2 of 4" — followed by **Previous** and **Next** side by side. Both
steps are always there; the one that leads nowhere is dimmed rather than
hidden, so the pair keeps its shape and a closed step says the end has been
reached. There is no row of page numbers: the list is read in order, and those
were numbers nobody pressed.

The control itself is always there too, both steps closed while the list fits
in one page — it appearing as a list crossed ten would move everything under
it, which is the shift the fixed-height card and the reserved scrollbar gutter
exist to avoid. An empty list reads "0 of 0" rather than "0–0 of 0", which
looks like a mistake.

In the console the control sits at the end of the tab strip rather than under
the table, where the tabs it pages are.

The visitor's card is always ten rows tall, short pages padded out with
spacers that are hidden from screen readers. They are the same markup as a real
row rather than a measured height, so the card is exactly right on the kiosk's
larger type and with the padding a touch screen adds — and the line moving does
not shift the page under somebody reading it.

The tab's own count stays the whole tab, and the kiosk heading stays the whole
room: a page size must never look like people leaving. The page number is
clamped rather than stored blindly, because the rows underneath refresh on
every poll and the page somebody is reading can stop existing while they are on
it — falling back to the last page beats rendering nothing. Moving to another
tab starts at page one, and so does changing a filter, since either makes a
different list rather than the same one with a row added.

The sheet is the record and the workbook is a view of it, so a removed row
stays filed exactly where it is and is left out when the workbook is built.
A removal never rewrites a month tab: taking a row out of one is what erasing
does, and erasing is the guarded action. Rollover files a removed row like any
other, which is also what keeps the board from growing without end — a removal
is reversible for the month it happened in, and a row both removed and
finished is filed away when that month closes, the same as every other
finished row.

Erasing is the other half, and an owner's alone: for a row that should never
have been kept — a duplicate check-in, a test entry, someone who asked not to
be recorded — `DELETE /api/entries/:id/record` takes it out of the month tab as
well as off the board, for good. It is offered on a removed row, not a live
one, so the reversible step always comes first. Both writes go through the same
queue as every other change, so nothing can file the row back between them.
Doing this by hand in Google Sheets does not work: the next sync merges the
board back into the tab and the row returns, with nobody told.

It is the one action nothing undoes, so three things stand in front of it. It
is owners only. It is a separate route from the removal staff use, so no
ordinary delete can reach it. And the caller has to send the person's name,
which the server checks against the row — the console asks the owner to type it
— so a stray or repeated request carries no name and is refused. Rows are
matched on sign-in time as well as id, the pair `mergeById` keys on: numbering
restarts at #1 when the board is emptied, so one month can hold two different
people as #3 and the id alone would take both.

## Exports

Two buttons, for two different jobs, both giving an Excel workbook.
**Download current list** takes the board as `current-list-YYYY-MM-DD.xlsx`, a
single **Current list** tab. **Download all months** takes the whole record as
`all-months-YYYY-MM-DD.xlsx`, a tab per month, laid out the same way.

One format for both, because two would not be intuitive: staff should be
choosing what is in the file, not what will open it. Neither label says
"Excel", since a format they share tells nobody which to press. So they are
named for what they hold — "spreadsheet" and "workbook" are the
same word to most people, and the difference that matters is whether the months
already filed away are in it.

All months is the one that reaches those: they are tabs of their own and no
longer on the board, so the current list cannot see them. It reads every month
tab the spreadsheet holds, and where a month is both filed and still on the
board the board's copy wins, being the fresher of the two.

Nothing is written: it is a read of the board and the month tabs, off the write
queue, so a download never holds up a check-in. However many months it spans,
it costs two Sheets calls — the tab list, and one batched read of every month
at once.

Both files are built by `server/sheet/xlsx.ts` — an `.xlsx` is a zip of a few
XML parts, and text cells need nothing more than that, so there is no
dependency behind it. Cells go in as inline strings, which a spreadsheet never
evaluates, so a name beginning `=` arrives as itself with no quoting and no
formula to run.

### The log layout

Both workbooks are laid out as the **SIGN IN LOG SPREADSHEET** tab of
`docs/Legal Triage Ticketing System.xlsx`, so a day's rows paste straight in:

| Date | Client Name | DOB | Gender | Phone # | Case Type | Appointment Type | Appointment Outcome | Notes | Legal Outcome | Time (0.25 increments) |
| ---- | ----------- | --- | ------ | ------- | --------- | ---------------- | ------------------- | ----- | ------------- | ---------------------- |
| 2026-08-05 | Ada Lovelace | 1990-04-02 | Female | 503-555-0142 | Housing/Eviction | Clinic | Completed | eviction notice | REFERRAL MADE | 1.25 |

The column order lives in `server/sheet/log.ts`, which `server/sheet/columns.ts`
reads too, so the tab and the exports can never drift apart.

Case Type, Appointment Type, Appointment Outcome, and Legal Outcome are the
controlled vocabularies from that workbook's **CARE4 CODES** tab, mirrored in
`server/shared/codes.ts` — the one place to edit if the workbook changes, alongside
the gender options. Notes holds the note typed when booking someone in and the
admin note, in that order.

Fields not in the log (id, status, who helped, timestamps) stay in the admin
console and the API; they are deliberately left out of the export.

Opens directly in Excel, Numbers, or Google Sheets.

## Scripts

| Command             | Does                                          |
| ------------------- | --------------------------------------------- |
| `npm run boot`      | `npm install`, then `npm run dev`             |
| `npm install`       | Also enables the pre-commit hook in `.githooks/` |
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
  about 30 seconds. (In development, where the shared passcode still works,
  there is nothing to revoke per person: change `ADMIN_PASSCODE` and restart,
  which locks out everyone.)
- "Helped by" is the signed-in identity where Google sign-in is on, and a name
  typed on the device where it is not.
- Both screens poll every 5 seconds rather than using websockets, and only
  while the tab is on screen — a phone left in a pocket stops polling and picks
  up again the moment it is looked at. The console's failed sign-in count is
  asked for every 30 seconds instead: it rarely changes, and polling it with
  the queue doubled every console's requests.
- Responses are compressed. The board's JSON is repetitive enough to go out at
  a sixteenth of its size, which matters when every screen in the room asks for
  it every five seconds. Small answers are left alone: below about 1KB the
  saving does not pay for itself, so a quiet waiting room's board goes out as
  it is.
- API answers carry `Cache-Control: no-cache` alongside their ETag, so a poll
  that finds nothing changed comes back as a bodyless `304` rather than the
  board in full. Without the directive the browser applies its own heuristic
  and asks for everything every time.
- **The pages ask not to be indexed.** The visitor screen carries names and why
  people are here, and a deployment is reachable without signing in, so
  `index.html` sets `robots: noindex, nofollow`. Nothing here is meant to be
  found by search.
- `public/` holds the icons: `favicon.svg`, and an `apple-touch-icon.png` for a
  tablet added to a home screen, which iOS will not take as SVG. The page also
  sets `theme-color` and the web-app meta tags, so a kiosk runs full screen
  rather than inside a browser with a URL bar.
- The staff console is a chunk of its own, fetched when someone opens
  `#/admin`. A visitor checking in never downloads it.
- Serve over HTTPS before using this anywhere beyond a trusted local network —
  the staff session cookie is sent with every admin request.
