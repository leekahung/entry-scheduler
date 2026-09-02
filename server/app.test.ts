import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp, isLocalAddress, publicName } from "./app.js";
import { fakeSheet } from "./sheet.fixture.js";
import { createStaffStore, type StaffStore } from "./staff.js";
import { createStore, type Store } from "./store.js";
import {
  SESSION_COOKIE,
  SESSION_MS,
  signSession,
  STATE_COOKIE,
} from "./auth.js";

const PASSCODE = "test-passcode";
const asAdmin = (req: request.Test) => req.set("x-admin-passcode", PASSCODE);

let store: Store;
let app: ReturnType<typeof createApp>;

const emptyStore = () => createStore(fakeSheet().transport);

beforeEach(() => {
  store = emptyStore();
  app = createApp(store, PASSCODE);
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
    const [entry] = await store.list();
    expect(entry.status).toBe("new");
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
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects every admin request when no passcode is configured", async () => {
    const openApp = createApp(emptyStore(), "");
    expect((await request(openApp).get("/api/entries.csv")).status).toBe(401);
  });
});

describe("csv export", () => {
  it("starts with a BOM so Excel reads non-ASCII names as UTF-8", async () => {
    await join("José Nguyễn");
    const res = await asAdmin(request(app).get("/api/entries.csv"));
    expect(res.status).toBe(200);
    expect(res.text.startsWith("\uFEFF")).toBe(true);
    expect(res.text).toContain("José Nguyễn");
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
    expect(await store.list()).toHaveLength(1);
  });

  it("hands out nothing a visitor could delete with", async () => {
    const res = await request(app).post("/api/entries").send({ name: "Ada" });
    // The whole payload rather than one field name: a capability token or a
    // private detail added later fails this instead of slipping through.
    expect(Object.keys(res.body).sort()).toEqual([
      "createdAt",
      "due",
      "id",
      "name",
      "scheduledFor",
      "status",
    ]);
  });

  it("still lets staff remove someone", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).delete(`/api/entries/${id}`));
    expect(res.status).toBe(204);
    expect(await store.list()).toHaveLength(0);
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

  it("refuses a name longer than the field allows", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(app).patch(`/api/entries/${id}`)).send({
      status: "pending",
      helpedBy: "K".repeat(81),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("80 characters or fewer");
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
    expect(await store.list()).toHaveLength(0);
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
    expect(await store.list()).toHaveLength(1);
  });

  it("blocks a wrong passcode from clearing the queue", async () => {
    await join("Ada");
    const res = await request(app)
      .delete("/api/entries")
      .set("x-admin-passcode", "wrong");
    expect(res.status).toBe(401);
    expect(await store.list()).toHaveLength(1);
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
    served = createApp(store, PASSCODE, staticDir);
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

    const rows = await store.list();
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
    expect(await store.list()).toHaveLength(0);
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
    expect((await store.list())[0].priority).toBe("routine");
  });

  it("will not let a visitor set their own triage level", async () => {
    const res = await request(app)
      .post("/api/entries")
      .send({ name: "Ada", priority: "emergency" });
    expect(res.status).toBe(201);
    expect((await store.list())[0].priority).toBe("routine");
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
    expect(await store.list()).toHaveLength(0);
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
    const statuses: number[] = [];
    for (let i = 0; i < 105; i++) {
      const res = await request(app)
        .post("/api/entries")
        .send({ name: `Flood ${i}` });
      statuses.push(res.status);
    }
    // Counted, not pinned to the 101st response: on a machine busy with other
    // work a reply can arrive from somewhere else entirely, and pinning the
    // index made this test fail roughly one run in twenty.
    expect(statuses).toContain(429);
    expect(
      statuses.filter((status) => status === 201).length,
    ).toBeLessThanOrEqual(100);
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

describe("the spreadsheet link", () => {
  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_ID;
  });

  it("hands the console the spreadsheet to link to once Sheets is configured", async () => {
    process.env.GOOGLE_SHEETS_ID = "sheet-123";

    const res = await asAdmin(request(app).post("/api/admin/verify"));
    expect(res.body.sheetUrl).toBe(
      "https://docs.google.com/spreadsheets/d/sheet-123/edit",
    );
  });

  it("returns no link when Sheets is unconfigured, so the console offers the CSV instead", async () => {
    const res = await asAdmin(request(app).post("/api/admin/verify"));
    expect(res.body).toEqual({ ok: true, sheetUrl: null });
  });
});

describe("staff sign-in with Google", () => {
  const OAUTH = {
    GOOGLE_OAUTH_CLIENT_ID: "client-123",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
    SESSION_SECRET: "a-long-signing-secret",
    ADMIN_EMAILS: "kim@clinic.org",
  };

  const enable = () => Object.assign(process.env, OAUTH);
  const sessionFor = (email: string, now?: number) =>
    `${SESSION_COOKIE}=${signSession(email, OAUTH.SESSION_SECRET, now)}`;

  afterEach(() => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
  });

  it("tells the console which sign-in to offer", async () => {
    expect((await request(app).get("/api/auth/mode")).body).toEqual({
      google: false,
    });
    enable();
    expect((await request(app).get("/api/auth/mode")).body).toEqual({
      google: true,
    });
  });

  it("stops accepting the shared passcode once Google is configured", async () => {
    enable();
    const res = await asAdmin(request(app).get("/api/entries"));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Sign in with Google to continue." });
  });

  it("lets an allowlisted address through on its session cookie", async () => {
    enable();
    const res = await request(app)
      .get("/api/entries")
      .set("cookie", sessionFor("kim@clinic.org"));
    expect(res.status).toBe(200);
  });

  it("refuses a valid session for an address off the allowlist", async () => {
    enable();
    const res = await request(app)
      .get("/api/entries")
      .set("cookie", sessionFor("stranger@clinic.org"));
    expect(res.status).toBe(401);
  });

  it("refuses an expired session", async () => {
    enable();
    const stale = sessionFor("kim@clinic.org", Date.now() - SESSION_MS - 1000);
    const res = await request(app).get("/api/entries").set("cookie", stale);
    expect(res.status).toBe(401);
  });

  it("refuses a session cookie signed with the wrong secret", async () => {
    enable();
    const forged = `${SESSION_COOKIE}=${signSession("kim@clinic.org", "not-the-secret")}`;
    const res = await request(app).get("/api/entries").set("cookie", forged);
    expect(res.status).toBe(401);
  });

  it("reports who is signed in, and 401s when nobody is", async () => {
    enable();
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    const res = await request(app)
      .get("/api/auth/me")
      .set("cookie", sessionFor("kim@clinic.org"));
    expect(res.body.email).toBe("kim@clinic.org");
  });

  it("sends staff to Google with a state cookie to come back with", async () => {
    enable();
    const res = await request(app).get("/api/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
    expect(res.headers.location).toContain("client-123");
    expect(res.headers["set-cookie"][0]).toContain(STATE_COOKIE);
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    enable();
    const res = await request(app)
      .get("/api/auth/callback?code=abc&state=forged")
      .set("cookie", `${STATE_COOKIE}=genuine`);
    // Redirected back to the console with something readable, not raw JSON.
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("authError=");
    expect(res.headers.location).toContain("#/admin");
  });

  it("refuses a callback carrying no code at all", async () => {
    enable();
    const res = await request(app).get("/api/auth/callback?state=x");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("authError=");
  });

  it("clears the session cookie on sign-out", async () => {
    enable();
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"][0]).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers["set-cookie"][0]).toContain("Max-Age=0");
  });

  it("still refuses an off-network caller holding a good session", async () => {
    enable();
    const offNetwork = createApp(store, PASSCODE);
    offNetwork.set("trust proxy", 1);
    const res = await request(offNetwork)
      .get("/api/entries")
      .set("cookie", sessionFor("kim@clinic.org"))
      .set("x-forwarded-for", "203.0.113.7");
    expect(res.status).toBe(401);
  });
});

describe("managing who has access", () => {
  const OAUTH = {
    GOOGLE_OAUTH_CLIENT_ID: "client-123",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
    SESSION_SECRET: "a-long-signing-secret",
    ADMIN_EMAILS: "boss@clinic.org",
  };

  let staff: StaffStore;
  let withStaff: ReturnType<typeof createApp>;

  const as = (email: string) =>
    `${SESSION_COOKIE}=${signSession(email, OAUTH.SESSION_SECRET)}`;

  beforeEach(() => {
    Object.assign(process.env, OAUTH);
    staff = createStaffStore(fakeSheet().transport);
    withStaff = createApp(store, PASSCODE, undefined, false, { staff });
  });

  afterEach(() => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
  });

  it("is unavailable without Google sign-in, so a shared passcode cannot grant access", async () => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
    const res = await asAdmin(request(withStaff).get("/api/admin/staff"));
    expect(res.status).toBe(501);
  });

  it("lets an owner from the environment read the list", async () => {
    const res = await request(withStaff)
      .get("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"));
    expect(res.status).toBe(200);
    expect(res.body.you).toEqual({ email: "boss@clinic.org", role: "owner" });
    expect(res.body.bootstrapOwners).toEqual(["boss@clinic.org"]);
  });

  it("lets an owner grant and revoke console access", async () => {
    const added = await request(withStaff)
      .post("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"))
      .send({ email: "Kim@Clinic.org", role: "staff" });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      email: "kim@clinic.org",
      role: "staff",
      addedBy: "boss@clinic.org",
    });

    // The granted address can now work the queue.
    expect(
      (
        await request(withStaff)
          .get("/api/entries")
          .set("cookie", as("kim@clinic.org"))
      ).status,
    ).toBe(200);

    const removed = await request(withStaff)
      .delete("/api/admin/staff/kim@clinic.org")
      .set("cookie", as("boss@clinic.org"));
    expect(removed.status).toBe(204);

    // And is locked out again straight away.
    expect(
      (
        await request(withStaff)
          .get("/api/entries")
          .set("cookie", as("kim@clinic.org"))
      ).status,
    ).toBe(401);
  });

  it("refuses a plain staff member the ability to grant access", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    const res = await request(withStaff)
      .post("/api/admin/staff")
      .set("cookie", as("kim@clinic.org"))
      .send({ email: "friend@clinic.org", role: "owner" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Only an owner can change who has access.",
    });
  });

  it("refuses a signed-out caller entirely", async () => {
    const res = await request(withStaff).get("/api/admin/staff");
    expect(res.status).toBe(401);
  });

  it("lets an owner added to the sheet manage the list too", async () => {
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaff)
      .post("/api/admin/staff")
      .set("cookie", as("kim@clinic.org"))
      .send({ email: "sam@clinic.org", role: "staff" });
    expect(res.status).toBe(201);
  });

  it("rejects a malformed address or an invented role", async () => {
    const bad = [
      { email: "not-an-address", role: "staff" },
      { email: "a@b.org,c@d.org", role: "staff" },
      { email: "sam@clinic.org", role: "superuser" },
      { email: "sam@clinic.org" },
    ];
    for (const body of bad) {
      const res = await request(withStaff)
        .post("/api/admin/staff")
        .set("cookie", as("boss@clinic.org"))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it("will not let an owner remove their own access", async () => {
    const res = await request(withStaff)
      .delete("/api/admin/staff/boss@clinic.org")
      .set("cookie", as("boss@clinic.org"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("your own access");
  });

  it("will not let a server-set owner be removed through the console", async () => {
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaff)
      .delete("/api/admin/staff/boss@clinic.org")
      .set("cookie", as("kim@clinic.org"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("set on the server");
  });

  it("404s an address that was never on the list", async () => {
    const res = await request(withStaff)
      .delete("/api/admin/staff/nobody@clinic.org")
      .set("cookie", as("boss@clinic.org"));
    expect(res.status).toBe(404);
  });

  it("changes a role rather than duplicating the row", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    await request(withStaff)
      .post("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"))
      .send({ email: "kim@clinic.org", role: "owner" });

    const res = await request(withStaff)
      .get("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"));
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].role).toBe("owner");
  });
});

describe("behind an unconfigured proxy", () => {
  // Cloud Run and most reverse proxies hand the container a private address as
  // the peer, so without `trust proxy` every caller would look on-site.
  const fromInternet = (app: ReturnType<typeof createApp>, path: string) =>
    request(app)
      .get(path)
      .set("x-admin-passcode", PASSCODE)
      .set("x-forwarded-for", "203.0.113.7");

  it("refuses admin requests carrying a forwarded header it was not told to trust", async () => {
    const res = await fromInternet(createApp(store, PASSCODE), "/api/entries");
    expect(res.status).toBe(401);
  });

  it("trusts the forwarded address once the hop count is configured", async () => {
    const proxied = createApp(store, PASSCODE);
    proxied.set("trust proxy", 1);
    // Two hops: the client, then the proxy the app is told to trust.
    const res = await request(proxied)
      .get("/api/entries")
      .set("x-admin-passcode", PASSCODE)
      .set("x-forwarded-for", "127.0.0.1, 10.0.0.1");
    expect(res.status).toBe(200);
  });

  it("still serves the public board through a proxy", async () => {
    const res = await request(createApp(store, PASSCODE))
      .get("/api/queue")
      .set("x-forwarded-for", "203.0.113.7");
    expect(res.status).toBe(200);
  });

  it("keeps staff management behind the same network rule as the queue", async () => {
    Object.assign(process.env, {
      GOOGLE_OAUTH_CLIENT_ID: "client-123",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
      SESSION_SECRET: "a-long-signing-secret-of-adequate-length",
      ADMIN_EMAILS: "boss@clinic.org",
    });
    const staff = createStaffStore(fakeSheet().transport);
    const app = createApp(store, PASSCODE, undefined, false, { staff });
    app.set("trust proxy", 1);

    const res = await request(app)
      .get("/api/admin/staff")
      .set(
        "cookie",
        `${SESSION_COOKIE}=${signSession("boss@clinic.org", "a-long-signing-secret-of-adequate-length")}`,
      )
      .set("x-forwarded-for", "203.0.113.7");
    expect(res.status).toBe(401);

    for (const key of [
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "SESSION_SECRET",
      "ADMIN_EMAILS",
    ]) {
      delete process.env[key];
    }
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

  // Enforcement itself is covered by the sign-in flood in "hardening", which
  // shares this limiter. Exhausting a 1200-request budget here only made the
  // test slow enough to drop a request and fail on a loaded machine.
  it("budgets the board for a roomful, not for one device", async () => {
    const res = await request(app).get("/api/queue");
    expect(Number(res.headers["ratelimit-limit"])).toBe(1200);
  });

  it("counts every board request against that budget", async () => {
    const first = await request(app).get("/api/queue");
    const second = await request(app).get("/api/queue");
    expect(Number(second.headers["ratelimit-remaining"])).toBe(
      Number(first.headers["ratelimit-remaining"]) - 1,
    );
  });

  it("leaves a roomful of polling visitors alone behind one address", async () => {
    // 10 visitors x 12 polls a minute, all sharing a NAT or proxy address.
    for (let i = 0; i < 120; i++) {
      expect((await request(app).get("/api/queue")).status).toBe(200);
    }
  });
});

describe("off-network admin access", () => {
  // trust proxy makes req.ip follow X-Forwarded-For, which is the only way to
  // present as a public address from loopback. It is also exactly the spoof
  // this guard would be exposed to if a real deployment enabled it carelessly.
  const fromPublicIp = (app: ReturnType<typeof createApp>, path: string) => {
    app.set("trust proxy", 1);
    return request(app)
      .get(path)
      .set("x-admin-passcode", PASSCODE)
      .set("x-forwarded-for", "203.0.113.7");
  };

  it("refuses a correct passcode from a public address", async () => {
    const res = await fromPublicIp(createApp(store, PASSCODE), "/api/entries");
    expect(res.status).toBe(401);
    // Identical to a bad passcode: no hint that the guard is what stopped it.
    expect(res.body).toEqual({ error: "Admin passcode required." });
  });

  it("refuses the CSV export and the alert feed too", async () => {
    for (const route of ["/api/entries.csv", "/api/admin/alerts"]) {
      const res = await fromPublicIp(createApp(store, PASSCODE), route);
      expect(res.status).toBe(401);
    }
  });

  it("still lets the public board through from anywhere", async () => {
    const app = createApp(store, PASSCODE);
    app.set("trust proxy", 1);
    const res = await request(app)
      .get("/api/queue")
      .set("x-forwarded-for", "203.0.113.7");
    expect(res.status).toBe(200);
  });

  it("opens up when allowRemoteAdmin is set", async () => {
    const res = await fromPublicIp(
      createApp(store, PASSCODE, undefined, true),
      "/api/entries",
    );
    expect(res.status).toBe(200);
  });
});
