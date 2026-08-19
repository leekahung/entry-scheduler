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
The console splits on it — **In the queue now** and **Scheduled later** — while
the ordering underneath stays one line.

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

**Check someone else in** clears that device for the next person. It does not
remove anyone from the queue — only staff can do that.

**Currently waiting** lists everyone in line as a number, a shortened name
("Ada L."), and a status. The shortening happens on the server, so the only
full name this screen ever holds is the reader's own.

## The staff console

<http://localhost:5173/#/admin> — one shared passcode, held in `sessionStorage`
for that tab. The console is refused outright from outside the local network
unless `ALLOW_REMOTE_ADMIN=true`.

**Helping as** — the name recorded against everyone you help. Type it once; it
persists on that device.

Three tables, all sharing the single queue order:

| Section              | Holds                                   |
| -------------------- | --------------------------------------- |
| **In the queue now** | Walk-ins and appointments that are due  |
| **Scheduled later**  | Appointments whose time has not arrived |
| **Done**             | Everyone already helped (collapsible)   |

Each row carries the number, full name, a triage dropdown, status, when they
joined, who helped, and three actions:

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
**Download spreadsheet**, **Sign out**, and **Clear all**, which empties the
queue and restarts numbering at #1 for a fresh day.

A banner warns when failed sign-in attempts pile up, so staff can see someone
guessing at the passcode. If the server stops accepting the session — a
restart with a different passcode, say — the console drops back to the sign-in
form rather than retrying, which would spend the rate-limit budget and lock
staff out of signing back in.

## Development

Node 20.12 or newer (the dev server uses `--env-file-if-exists`).
`better-sqlite3` is a native module, so `npm install` compiles it.

```bash
cp .env.example .env      # then set ADMIN_PASSCODE — at least 12 characters
npm run boot              # installs dependencies, then starts both servers
```

`npm run boot` is the one command from a fresh clone. Day to day, `npm run dev`
does the same without re-checking dependencies.

`npm run dev` runs both halves together: the API on **:3001** and Vite on
**:5173**, with `/api` proxied across so there is one URL to open.

- Visitors: <http://localhost:5173>
- Staff: <http://localhost:5173/#/admin>

The server refuses to start without `ADMIN_PASSCODE`, and refuses a passcode
under 12 characters — it is the whole security of the console. To run a
throwaway instance without touching your real queue, point both at somewhere
else:

```bash
ADMIN_PASSCODE=scratch-passcode-123 DB_FILE=/tmp/scratch.db npm run dev
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

Set these on the host:

| Variable         | Notes                                                    |
| ---------------- | -------------------------------------------------------- |
| `ADMIN_PASSCODE` | Required. The server refuses to start without it.        |
| `PORT`           | Most hosts set this for you; defaults to 3001.           |
| `DB_FILE`        | Point at a **persistent disk**, e.g. `/data/entries.db`. |

Build command `npm run build`, start command `npm start`.

The database is a SQLite file. On hosts with ephemeral filesystems (the default
on Render, Railway, Fly) the queue is wiped on every deploy and restart unless
`DB_FILE` points at a mounted volume. This is the most common way this setup
breaks.

Two other things to get right before real use:

- **Serve over HTTPS.** The admin passcode travels as a plaintext header, so on
  plain HTTP anyone on the network path can read it. Every managed host
  terminates TLS for you; just don't skip it.
- **Set a strong `ADMIN_PASSCODE`.** Once deployed the URL is publicly
  reachable. Failed admin requests are rate limited — 30 per 15 minutes per
  address, successful ones not counted — but that only slows guessing down.

If you deploy with Docker, `better-sqlite3` is a native module and must be
rebuilt inside the image — run `npm ci` in the container rather than copying
`node_modules` from your machine.

## Who can do what

Permissions are enforced on the server, not just hidden in the UI — the admin
routes reject any request without the `x-admin-passcode` header, so a visitor
cannot change a status or pull the export by calling the API directly.

| Action                                    | Visitor | Admin |
| ----------------------------------------- | ------- | ----- |
| Check in with a name                      | ✅      | ✅    |
| Give DOB, phone, gender                   | ✅      | ✅    |
| Set the case type                         | ❌      | ✅    |
| Book someone in / set an appointment      | ❌      | ✅    |
| Set a triage level                        | ❌      | ✅    |
| Record appointment / legal outcome        | ❌      | ✅    |
| See who is waiting (short names + status) | ✅      | ✅    |
| See full names                            | ❌      | ✅    |
| Change a status / flag as helped          | ❌      | ✅    |
| Write or read notes                       | ❌      | ✅    |
| See timestamps and who helped             | ❌      | ✅    |
| Export CSV                                | ❌      | ✅    |
| Remove an entry                           | ❌      | ✅    |

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
`server/codes.ts` — the one place to edit if the workbook changes, alongside
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

- Data lives in a local SQLite file (`entries.db`, configurable via `DB_FILE`).
- **Sign out** clears the admin session for that tab. Because the passcode is
  shared, signing out protects the laptop from the next person who walks up — it
  does not revoke the code itself. If a passcode leaks, change `ADMIN_PASSCODE`
  and restart; that is the only way to lock someone out.
- The admin screen is gated by one shared passcode held in `sessionStorage`;
  there are no per-user accounts, so "helped by" is a name typed by staff, not a
  verified identity.
- Both screens poll every 5 seconds rather than using websockets.
- Serve over HTTPS before using this anywhere beyond a trusted local network —
  the passcode is sent as a plain header.
