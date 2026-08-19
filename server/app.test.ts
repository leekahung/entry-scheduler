import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp, isLocalAddress, publicName } from "./app.js";
import Database from "better-sqlite3";
import { listEntries, openDb, type Db } from "./db.js";

const PASSCODE = "test-passcode";
const asAdmin = (req: request.Test) => req.set("x-admin-passcode", PASSCODE);

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp(db, PASSCODE);
});

async function join(name: string, note = "") {
  const res = await request(app).post("/api/entries").send({ name, note });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("public access", () => {
  it("lets anyone join the queue with just a name", async () => {
    const res = await request(app).post("/api/entries").send({ name: "Ada" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Ada", status: "new" });
  });

  it("rejects a blank or whitespace-only name", async () => {
    for (const name of ["", "   "]) {
      const res = await request(app).post("/api/entries").send({ name });
      expect(res.status).toBe(400);
    }
  });

  it("hides admin bookkeeping fields from the public queue", async () => {
    await join("Ada");
    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty("helpedBy");
    expect(res.body[0]).not.toHaveProperty("note");
  });
});

describe("admin gate", () => {
  it("blocks status changes without the passcode", async () => {
    const id = await join("Ada");
    const res = await request(app)
      .patch(`/api/entries/${id}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(401);
    expect(
      db.prepare("SELECT status FROM entries WHERE id = ?").get(id),
    ).toEqual({
      status: "new",
    });
  });

  it("blocks status changes with a wrong passcode", async () => {
    const id = await join("Ada");
    const res = await request(app)
      .patch(`/api/entries/${id}`)
      .set("x-admin-passcode", "wrong")
      .send({ status: "resolved" });
    expect(res.status).toBe(401);
  });

  it("blocks CSV export and full records without the passcode", async () => {
    await join("Ada");
    expect((await request(app).get("/api/entries.csv")).status).toBe(401);
    expect((await request(app).get("/api/entries")).status).toBe(401);
  });

  it("blocks deletion without the passcode", async () => {
    const id = await join("Ada");
    expect((await request(app).delete(`/api/entries/${id}`)).status).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS n FROM entries").get()).toEqual({
      n: 1,
    });
  });

  it("rejects every admin request when no passcode is configured", async () => {
    const openApp = createApp(openDb(":memory:"), "");
    expect((await request(openApp).get("/api/entries.csv")).status).toBe(401);
  });
});

describe("public names", () => {
  it("shortens a surname to an initial", () => {
    expect(publicName("Ada Lovelace")).toBe("Ada L.");
    expect(publicName("Chien-Shiung Wu")).toBe("Chien-Shiung W.");
    expect(publicName("Mary Anne Evans")).toBe("Mary Anne E.");
  });

  it("leaves a single name alone", () => {
    expect(publicName("Ada")).toBe("Ada");
  });

  it("handles a surname outside the BMP without splitting the character", () => {
    // "𝒜lpha" starts with a surrogate pair; last[0] would emit half of it.
    const shortened = publicName("Ada 𝒜lpha");
    expect(shortened).toBe("Ada 𝒜.");
    expect(shortened).not.toContain("�");
  });

  it("serves shortened names on the public queue but full names to admins", async () => {
    await join("Ada Lovelace");

    const publicRes = await request(app).get("/api/queue");
    expect(publicRes.body[0].name).toBe("Ada L.");
    expect(publicRes.text).not.toContain("Lovelace");

    const adminRes = await asAdmin(request(app).get("/api/entries"));
    expect(adminRes.body[0].name).toBe("Ada Lovelace");
  });

  it("returns the full name to the visitor who just joined", async () => {
    const res = await request(app)
      .post("/api/entries")
      .send({ name: "Ada Lovelace" });
    expect(res.body.name).toBe("Ada Lovelace");
  });
});

describe("leaving the queue", () => {
  it("gives visitors no way to remove themselves", async () => {
    const id = await join("Ada");
    const res = await request(app).post(`/api/entries/${id}/cancel`).send({});
    expect(res.status).toBe(404);
    expect(listEntries(db)).toHaveLength(1);
  });

  it("hands out nothing a visitor could delete with", async () => {
    const res = await request(app).post("/api/entries").send({ name: "Ada" });
    expect(res.body).not.toHaveProperty("cancelToken");
  });

  it("still lets staff remove someone", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).delete(`/api/entries/${id}`));
    expect(res.status).toBe(204);
    expect(listEntries(db)).toHaveLength(0);
  });

  it("refuses an unauthenticated delete", async () => {
    const id = await join("Ada");
    expect((await request(app).delete(`/api/entries/${id}`)).status).toBe(401);
    expect(listEntries(db)).toHaveLength(1);
  });
});

describe("admin notes", () => {
  it("saves a note without touching the status", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      adminNote: "Needs a loaner laptop",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      adminNote: "Needs a loaner laptop",
      status: "new",
    });
  });

  it("keeps the note when the status later changes", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      adminNote: "Loaner laptop",
    });
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });
    expect(res.body).toMatchObject({
      adminNote: "Loaner laptop",
      status: "resolved",
    });
  });

  it("never exposes admin notes on the public queue", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      adminNote: "secret staff context",
    });

    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty("adminNote");
    expect(res.text).not.toContain("secret staff context");
  });

  it("blocks guests from writing a note", async () => {
    const id = await join("Ada");
    const res = await request(app)
      .patch(`/api/entries/${id}`)
      .send({ adminNote: "sneaky" });
    expect(res.status).toBe(401);
  });

  it("rejects a note over the length limit", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      adminNote: "x".repeat(501),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a patch with nothing to update", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send(
      {},
    );
    expect(res.status).toBe(400);
  });

  it("adds the column to a database created before notes existed", () => {
    const legacy = new Database(":memory:");
    legacy.exec(`
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        helpedBy TEXT NOT NULL DEFAULT ''
      )
    `);
    legacy
      .prepare(
        "INSERT INTO entries (name, createdAt, updatedAt) VALUES ('Legacy', 'x', 'x')",
      )
      .run();
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "legacy-")),
      "old.db",
    );
    legacy.exec(`VACUUM INTO '${file}'`);
    legacy.close();

    const migrated = openDb(file);
    const rows = listEntries(migrated);
    expect(rows[0]).toMatchObject({ name: "Legacy", adminNote: "" });
  });
});

describe("correcting who helped", () => {
  it("changes helpedBy without touching the status", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "pending",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      helpedBy: "Jordan",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ helpedBy: "Jordan", status: "pending" });
  });

  it("clears helpedBy when given an empty string", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      helpedBy: "",
    });
    expect(res.body).toMatchObject({ helpedBy: "", status: "resolved" });
  });

  it("keeps the existing name when helpedBy is omitted", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "pending",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "resolved",
    });
    expect(res.body).toMatchObject({ helpedBy: "Kim", status: "resolved" });
  });

  it("keeps a name typed onto an entry that is still waiting", async () => {
    // Regression: the Edit panel sends helpedBy with no status, and a waiting
    // entry's status is already "new" — the name must not be discarded.
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      helpedBy: "Kim",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ helpedBy: "Kim", status: "new" });
  });

  it("still clears the name when an entry is reopened", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "new",
    });
    expect(res.body).toMatchObject({ helpedBy: "", status: "new" });
  });

  it("blocks guests from rewriting who helped", async () => {
    const id = await join("Ada");
    const res = await request(app)
      .patch(`/api/entries/${id}`)
      .send({ helpedBy: "impostor" });
    expect(res.status).toBe(401);
  });
});

describe("clearing the whole queue", () => {
  it("removes every entry and reports the count", async () => {
    await join("Ada");
    await join("Grace");
    await join("Katherine");

    const res = await asAdmin(request(app).delete("/api/entries"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 3 });
    expect(listEntries(db)).toHaveLength(0);
  });

  it("restarts numbering at #1 afterwards", async () => {
    await join("Ada");
    await join("Grace");
    await asAdmin(request(app).delete("/api/entries"));

    const res = await request(app).post("/api/entries").send({ name: "Mae" });
    expect(res.body.id).toBe(1);
  });

  it("blocks guests from clearing the queue", async () => {
    await join("Ada");
    const res = await request(app).delete("/api/entries");
    expect(res.status).toBe(401);
    expect(listEntries(db)).toHaveLength(1);
  });

  it("blocks a wrong passcode from clearing the queue", async () => {
    await join("Ada");
    const res = await request(app)
      .delete("/api/entries")
      .set("x-admin-passcode", "wrong");
    expect(res.status).toBe(401);
    expect(listEntries(db)).toHaveLength(1);
  });

  it("is harmless on an already-empty queue", async () => {
    const res = await asAdmin(request(app).delete("/api/entries"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 0 });
  });
});

describe("serving the built frontend", () => {
  let staticDir: string;
  let served: ReturnType<typeof createApp>;

  beforeEach(() => {
    staticDir = mkdtempSync(path.join(tmpdir(), "entry-scheduler-"));
    writeFileSync(
      path.join(staticDir, "index.html"),
      "<!doctype html><title>App</title>",
    );
    writeFileSync(path.join(staticDir, "app.js"), "console.log('bundle');");
    served = createApp(db, PASSCODE, staticDir);
  });

  afterEach(() => rmSync(staticDir, { recursive: true, force: true }));

  it("serves index.html at the root", async () => {
    const res = await request(served).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>App</title>");
  });

  it("serves built assets", async () => {
    const res = await request(served).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("bundle");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await request(served).get("/admin");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>App</title>");
  });

  it("404s a missing asset instead of returning the HTML shell", async () => {
    // Returning index.html for a .js or .ico request surfaces as a confusing
    // MIME parse error in the browser rather than a clear missing file.
    for (const missing of ["/favicon.ico", "/assets/stale-abc123.js"]) {
      const res = await request(served).get(missing);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("<title>App</title>");
    }
  });

  it("still 404s unknown API routes as JSON, not the SPA shell", async () => {
    const res = await request(served).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.text).not.toContain("<title>App</title>");
  });

  it("keeps the admin gate closed on the API while serving the SPA", async () => {
    const res = await request(served).get("/api/entries.csv");
    expect(res.status).toBe(401);
  });
});

describe("admin actions", () => {
  it("flags an entry as helped and records who did it", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "resolved",
      helpedBy: "Grace",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "resolved", helpedBy: "Grace" });
    expect(res.body.updatedAt >= res.body.createdAt).toBe(true);
  });

  it("rejects a status outside new/pending/resolved", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "done",
    });
    expect(res.status).toBe(400);
  });

  it("404s on an unknown entry", async () => {
    const res = await asAdmin(request(app).patch("/api/entries/999")).send({
      status: "pending",
    });
    expect(res.status).toBe(404);
  });

  it("exports every entry and status as CSV", async () => {
    const first = await join("Ada", "needs a laptop");
    await join("Grace");
    await asAdmin(request(app).patch(`/api/entries/${first}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(app).get("/api/entries.csv"));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    // attachment() must not clobber the charset, or non-ASCII names mis-decode.
    expect(res.headers["content-type"]).toContain("charset=utf-8");

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Client Name,DOB,Gender,Phone #,Case Type,Appointment Type," +
        "Appointment Outcome,Notes,Legal Outcome,Time (0.25 increments)",
    );
    expect(lines[1]).toContain('"Ada"');
    expect(lines[1]).toContain('"needs a laptop"');
    expect(lines[2]).toContain('"Grace"');
  });
});

describe("sign-in log fields", () => {
  const intake = {
    name: "Ada",
    dob: "1990-04-02",
    gender: "Female",
    phone: "503-555-0142",
    caseType: "Housing/Eviction",
  };

  it("stores the intake details a visitor gives at sign-in", async () => {
    const res = await request(app).post("/api/entries").send(intake);
    expect(res.status).toBe(201);

    const rows = listEntries(db);
    expect(rows[0]).toMatchObject(intake);
  });

  it("keeps intake details out of the public queue", async () => {
    await request(app).post("/api/entries").send(intake);
    const res = await request(app).get("/api/queue");
    for (const field of ["dob", "gender", "phone", "caseType"]) {
      expect(res.body[0]).not.toHaveProperty(field);
    }
  });

  it("refuses an intake field that is not text rather than blanking it", async () => {
    // Trimming a number down to "" would drop a phone the client did supply.
    const res = await request(app)
      .post("/api/entries")
      .send({ name: "Ada", phone: 5035550142 });
    expect(res.status).toBe(400);
    expect(listEntries(db)).toHaveLength(0);
  });

  it("rejects a gender outside the offered options", async () => {
    const res = await request(app)
      .post("/api/entries")
      .send({ name: "Ada", gender: "Woman" });
    expect(res.status).toBe(400);
  });

  it("lets staff fill in the intake fields afterwards", async () => {
    const created = await request(app)
      .post("/api/entries")
      .send({ name: "Ada" });
    const res = await asAdmin(
      request(app).patch(`/api/entries/${created.body.id}`),
    ).send({
      dob: "1990-04-02",
      gender: "Non-binary",
      phone: "503-555-0142",
      caseType: "Housing/Eviction",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dob: "1990-04-02",
      gender: "Non-binary",
      phone: "503-555-0142",
      caseType: "Housing/Eviction",
    });
  });

  it("rejects a case type that is not one of the CARE4 codes", async () => {
    const res = await request(app)
      .post("/api/entries")
      .send({ name: "Ada", caseType: "Space Law" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed or future date of birth", async () => {
    for (const dob of ["02/04/1990", "1990-02-31", "3000-01-01"]) {
      const res = await request(app)
        .post("/api/entries")
        .send({ name: "Ada", dob });
      expect(res.status).toBe(400);
    }
  });

  it("lets staff record the appointment and legal outcome", async () => {
    const id = await join("Ada");
    const details = {
      appointmentType: "Clinic",
      appointmentOutcome: "Completed",
      legalOutcome: "FILED- EXPUNGEMENT",
      timeSpent: 1.75,
    };

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send(
      details,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(details);
  });

  it("rejects codes and times the log cannot hold", async () => {
    const id = await join("Ada");
    for (const body of [
      { appointmentType: "Brunch" },
      { appointmentOutcome: "Maybe" },
      { legalOutcome: "FILED- SOMETHING" },
      { timeSpent: 0.3 },
      { timeSpent: -1 },
      { timeSpent: "1.25" },
    ]) {
      const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send(
        body,
      );
      expect(res.status).toBe(400);
    }
  });

  it("clears a coded field when staff pick the blank option", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      appointmentType: "Clinic",
    });

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      appointmentType: "",
    });
    expect(res.body.appointmentType).toBe("");
  });

  it("leaves case fields alone when only the status changes", async () => {
    const id = await join("Ada");
    await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      legalOutcome: "CONSULT ONLY",
      timeSpent: 0.5,
    });

    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "resolved",
    });
    expect(res.body).toMatchObject({
      legalOutcome: "CONSULT ONLY",
      timeSpent: 0.5,
    });
  });
});

describe("triage and appointments", () => {
  const book = (body: Record<string, unknown>) =>
    asAdmin(request(app).post("/api/admin/entries")).send(body);

  const queueIds = async () =>
    (await request(app).get("/api/queue")).body.map(
      (entry: { id: number }) => entry.id,
    );

  it("orders the queue by triage level before arrival", async () => {
    const first = await join("Ada");
    const second = await join("Grace");
    await asAdmin(request(app).patch(`/api/entries/${second}`)).send({
      priority: "emergency",
    });

    expect(await queueIds()).toEqual([second, first]);
  });

  it("keeps arrival order within one triage level", async () => {
    const first = await join("Ada");
    const second = await join("Grace");
    expect(await queueIds()).toEqual([first, second]);
  });

  it("defaults a walk-in to routine", async () => {
    await join("Ada");
    expect(listEntries(db)[0].priority).toBe("routine");
  });

  it("will not let a visitor set their own triage level", async () => {
    const res = await request(app)
      .post("/api/entries")
      .send({ name: "Ada", priority: "emergency" });
    expect(res.status).toBe(201);
    expect(listEntries(db)[0].priority).toBe("routine");
  });

  it("keeps the triage level off the public board", async () => {
    await join("Ada");
    const res = await request(app).get("/api/queue");
    expect(res.body[0]).not.toHaveProperty("priority");
  });

  it("slots an appointment into the line at its start time", async () => {
    // Ada walks in now; Grace is booked for an hour from now, so Grace waits.
    const walkIn = await join("Ada");
    const later = await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(later.status).toBe(201);

    expect(await queueIds()).toEqual([walkIn, later.body.id]);
  });

  it("puts an overdue appointment ahead of a later walk-in", async () => {
    const earlier = await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const walkIn = await join("Ada");

    expect(await queueIds()).toEqual([earlier.body.id, walkIn]);
  });

  it("keeps an urgent appointment at the back until it is due", async () => {
    // Otherwise the board announces someone who has not arrived yet as next.
    const walkIn = await join("Ada");
    const soon = await book({
      name: "Grace",
      priority: "emergency",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(await queueIds()).toEqual([walkIn, soon.body.id]);
  });

  it("lets a due emergency appointment take the front", async () => {
    const walkIn = await join("Ada");
    const overdue = await book({
      name: "Grace",
      priority: "emergency",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(await queueIds()).toEqual([overdue.body.id, walkIn]);
  });

  it("shows a visitor their appointment time but not their triage", async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    await book({ name: "Grace", scheduledFor: at, priority: "urgent" });

    const res = await request(app).get("/api/queue");
    expect(res.body[0].scheduledFor).toBe(at);
    expect(res.body[0]).not.toHaveProperty("priority");
  });

  it("rejects an unknown triage level or unparseable time", async () => {
    expect((await book({ name: "Ada", priority: "whenever" })).status).toBe(
      400,
    );
    expect(
      (await book({ name: "Ada", scheduledFor: "next tuesday" })).status,
    ).toBe(400);

    const id = await join("Ada");
    const patch = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      priority: "whenever",
    });
    expect(patch.status).toBe(400);
  });

  it("normalizes a non-ISO appointment time before storing it", async () => {
    // Stored verbatim it would sort against ISO timestamps by raw text and
    // land anywhere in the line.
    const created = await book({
      name: "Grace",
      scheduledFor: "Aug 17, 2026 11:00 PM",
    });
    expect(created.status).toBe(201);
    expect(created.body.scheduledFor).toBe(
      new Date("Aug 17, 2026 11:00 PM").toISOString(),
    );

    const patched = await asAdmin(
      request(app).patch(`/api/entries/${created.body.id}`),
    ).send({ scheduledFor: "Aug 18, 2026 9:30 AM" });
    expect(patched.body.scheduledFor).toBe(
      new Date("Aug 18, 2026 9:30 AM").toISOString(),
    );
  });

  it("tells the board whether each entry has joined the line", async () => {
    await join("Ada");
    await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const res = await request(app).get("/api/queue");
    expect(res.body.map((e: { due: boolean }) => e.due)).toEqual([true, false]);
  });

  it("marks an overdue appointment as due", async () => {
    await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await request(app).get("/api/queue");
    expect(res.body[0].due).toBe(true);
  });

  it("reports due-ness to the console too, so both views agree", async () => {
    await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await asAdmin(request(app).get("/api/entries"));
    expect(res.body[0].due).toBe(false);
  });

  it("rejects an appointment time that is only accidentally a date", async () => {
    // new Date("5") is 2001-05-01, which would sort ahead of every walk-in.
    for (const scheduledFor of ["5", "12", "nonsense"]) {
      expect((await book({ name: "Grace", scheduledFor })).status).toBe(400);
    }
  });

  it("rejects bad intake identically on both create paths", async () => {
    // These once diverged: the public path rejected, the admin path silently
    // truncated, losing part of a client's phone number without saying so.
    // Both now share checkNewEntry, so they cannot answer differently.
    const rejected = [
      { gender: "Woman" },
      { phone: "5".repeat(60) },
      { note: "n".repeat(400) },
      { name: "A".repeat(100) },
      { dob: "3000-01-01" },
      { caseType: "Space Law" },
    ];

    for (const bad of rejected) {
      const visitor = await request(app)
        .post("/api/entries")
        .send({ name: "Ada", ...bad });
      const staff = await book({ name: "Ada", ...bad });

      expect([visitor.status, staff.status]).toEqual([400, 400]);
      expect(visitor.body.error).toBe(staff.body.error);
    }
    expect(listEntries(db)).toHaveLength(0);
  });

  it("rejects a non-text helped-by or admin note", async () => {
    // JSON lets a client send a number or object where text is expected; it
    // must not reach the database as one.
    const id = await join("Ada");
    for (const body of [
      { helpedBy: 42 },
      { adminNote: { text: "nope" } },
      { helpedBy: null },
    ]) {
      const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send(
        body,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must be text/);
    }
  });

  it("requires the admin passcode to book someone in", async () => {
    const res = await request(app)
      .post("/api/admin/entries")
      .send({ name: "Ada" });
    expect(res.status).toBe(401);
  });

  it("books a walk-up with no time as an ordinary queue entry", async () => {
    const res = await book({ name: "Ada", caseType: "Traffic" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      scheduledFor: "",
      priority: "routine",
      caseType: "Traffic",
    });
  });

  it("clears an appointment back to a walk-in", async () => {
    const created = await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await asAdmin(
      request(app).patch(`/api/entries/${created.body.id}`),
    ).send({ scheduledFor: "" });
    expect(res.body.scheduledFor).toBe("");
  });
});

describe("hardening", () => {
  it("throttles repeated failed admin attempts", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (
        await request(app)
          .post("/api/admin/verify")
          .set("x-admin-passcode", `guess-${i}`)
      ).status;
    }
    expect(last).toBe(429);
  });

  it("does not throttle admin requests that succeed", async () => {
    for (let i = 0; i < 40; i++) {
      expect((await asAdmin(request(app).get("/api/entries"))).status).toBe(
        200,
      );
    }
  });

  it("throttles a flood of sign-ins from one address", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (
        await request(app)
          .post("/api/entries")
          .send({ name: `Flood ${i}` })
      ).status;
    }
    expect(last).toBe(429);
  });

  it("answers malformed JSON with an error that carries no stack trace", async () => {
    const res = await request(app)
      .post("/api/entries")
      .set("Content-Type", "application/json")
      .send("{bad json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Bad request." });
    expect(res.text).not.toContain("SyntaxError");
    expect(res.text).not.toContain(".ts:");
  });

  it("sets framing and sniffing protections, and hides the server stack", async () => {
    const res = await request(app).get("/api/queue");
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    // Plain-HTTP LAN deploys break if assets get upgraded to https.
    expect(res.headers["content-security-policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("failed sign-in warnings", () => {
  it("reports nothing when every request has been authorised", async () => {
    const res = await asAdmin(request(app).get("/api/admin/alerts"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ failedAttempts: 0, lastAttemptAt: null });
  });

  it("counts failed attempts and timestamps the most recent one", async () => {
    for (const guess of ["a", "b", "c"]) {
      await request(app)
        .post("/api/admin/verify")
        .set("x-admin-passcode", guess);
    }

    const res = await asAdmin(request(app).get("/api/admin/alerts"));
    expect(res.body.failedAttempts).toBe(3);
    expect(res.body.windowMinutes).toBe(15);
    expect(Date.parse(res.body.lastAttemptAt)).toBeLessThanOrEqual(Date.now());
  });

  it("keeps the alert feed behind the passcode", async () => {
    const res = await request(app).get("/api/admin/alerts");
    expect(res.status).toBe(401);
  });

  it("tells a rejected caller how many attempts remain", async () => {
    const res = await request(app)
      .post("/api/admin/verify")
      .set("x-admin-passcode", "wrong");

    expect(res.status).toBe(401);
    // The sign-in screen counts down from this header.
    expect(Number(res.headers["ratelimit-remaining"])).toBe(29);
  });
});

describe("network scoping", () => {
  it("treats loopback, private, and link-local addresses as on-site", () => {
    for (const ip of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "10.0.0.5",
      "192.168.254.52",
      "::ffff:192.168.1.20",
      "172.16.0.1",
      "172.31.255.254",
      "169.254.10.1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isLocalAddress(ip)).toBe(true);
    }
  });

  it("treats public addresses as off-site", () => {
    for (const ip of [
      "8.8.8.8",
      "203.0.113.7",
      "::ffff:203.0.113.7",
      "2606:4700::1111",
      // Neighbours of the private blocks that are not themselves private.
      "172.15.0.1",
      "172.32.0.1",
      "11.0.0.1",
      "192.169.0.1",
      "9.255.255.255",
    ]) {
      expect(isLocalAddress(ip)).toBe(false);
    }
  });

  it("still serves admin requests from the local network", async () => {
    // supertest connects over loopback, so every other admin test covers the
    // allow path; this pins the default to closed rather than open.
    expect((await asAdmin(request(app).get("/api/entries"))).status).toBe(200);
  });

  it("throttles a scrape of the public board", async () => {
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await request(app).get("/api/queue")).status;
    }
    expect(last).toBe(429);
  });

  it("leaves a normally polling visitor alone", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await request(app).get("/api/queue")).status).toBe(200);
    }
  });
});

describe("off-network admin access", () => {
  // trust proxy makes req.ip follow X-Forwarded-For, which is the only way to
  // present as a public address from loopback. It is also exactly the spoof
  // this guard would be exposed to if a real deployment enabled it carelessly.
  const fromPublicIp = (app: ReturnType<typeof createApp>, path: string) => {
    app.set("trust proxy", true);
    return request(app)
      .get(path)
      .set("x-admin-passcode", PASSCODE)
      .set("x-forwarded-for", "203.0.113.7");
  };

  it("refuses a correct passcode from a public address", async () => {
    const res = await fromPublicIp(createApp(db, PASSCODE), "/api/entries");
    expect(res.status).toBe(401);
    // Identical to a bad passcode: no hint that the guard is what stopped it.
    expect(res.body).toEqual({ error: "Admin passcode required." });
  });

  it("refuses the CSV export and the alert feed too", async () => {
    for (const route of ["/api/entries.csv", "/api/admin/alerts"]) {
      const res = await fromPublicIp(createApp(db, PASSCODE), route);
      expect(res.status).toBe(401);
    }
  });

  it("still lets the public board through from anywhere", async () => {
    const app = createApp(db, PASSCODE);
    app.set("trust proxy", true);
    const res = await request(app)
      .get("/api/queue")
      .set("x-forwarded-for", "203.0.113.7");
    expect(res.status).toBe(200);
  });

  it("opens up when allowRemoteAdmin is set", async () => {
    const res = await fromPublicIp(
      createApp(db, PASSCODE, undefined, true),
      "/api/entries",
    );
    expect(res.status).toBe(200);
  });
});
