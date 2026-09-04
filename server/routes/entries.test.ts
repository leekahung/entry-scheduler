import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import request from "supertest";
import { createApp } from "../app.js";
import { fakeSheet } from "../sheet/sheet.fixture.js";
import {
  createStore,
  type SheetTransport,
  type Store,
} from "../sheet/store.js";
import { asAdmin, emptyStore, PASSCODE } from "./routes.fixture.js";

let store: Store;
let app: ReturnType<typeof createApp>;
// One listener for the whole file, delegating to whichever app the current
// test built. `request(app)` would open an ephemeral port per call, and even
// binding one per test churned enough of them that a request occasionally
// landed on a reused port and came back as someone else's answer.
const server = createServer((req, res) => app(req, res));

beforeEach(() => {
  store = emptyStore();
  app = createApp(store, PASSCODE);
});

beforeAll(
  () => new Promise((ready) => server.listen(0, () => ready(undefined))),
);
afterAll(() => new Promise((done) => server.close(() => done(undefined))));

async function join(name: string, note = "") {
  const res = await request(server).post("/api/entries").send({ name, note });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("csv export", () => {
  it("starts with a BOM so Excel reads non-ASCII names as UTF-8", async () => {
    await join("José Nguyễn");
    const res = await asAdmin(request(server).get("/api/entries.csv"));
    expect(res.status).toBe(200);
    expect(res.text.startsWith("\uFEFF")).toBe(true);
    expect(res.text).toContain("José Nguyễn");
  });
});

describe("month tabs", () => {
  it("reports the months it saved and leaves the board alone", async () => {
    const tabs = new Map<string, SheetTransport>();
    const tabbed = createApp(
      createStore(fakeSheet().transport, {
        openTab(tab) {
          const sheet = tabs.get(tab) ?? fakeSheet().transport;
          tabs.set(tab, sheet);
          return sheet;
        },
      }),
      PASSCODE,
    );
    await request(tabbed).post("/api/entries").send({ name: "Ada" });

    const res = await asAdmin(request(tabbed).post("/api/entries/archive"));
    expect(res.status).toBe(200);
    expect(res.body.entries).toBe(1);
    expect(res.body.months).toHaveLength(1);
    expect(
      (await asAdmin(request(tabbed).get("/api/entries"))).body,
    ).toHaveLength(1);
  });
});

describe("admin notes", () => {
  it("saves a note without touching the status", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        adminNote: "Needs a loaner laptop",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      adminNote: "Needs a loaner laptop",
      status: "new",
    });
  });

  it("keeps the note when the status later changes", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      adminNote: "Loaner laptop",
    });
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "resolved",
        helpedBy: "Kim",
      },
    );
    expect(res.body).toMatchObject({
      adminNote: "Loaner laptop",
      status: "resolved",
    });
  });

  it("never exposes admin notes on the public queue", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      adminNote: "secret staff context",
    });

    const res = await request(server).get("/api/queue");
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty("adminNote");
    expect(res.text).not.toContain("secret staff context");
  });

  it("blocks guests from writing a note", async () => {
    const id = await join("Ada");
    const res = await request(server)
      .patch(`/api/entries/${id}`)
      .send({ adminNote: "sneaky" });
    expect(res.status).toBe(401);
  });

  it("rejects a note over the length limit", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        adminNote: "x".repeat(501),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a patch with nothing to update", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {},
    );
    expect(res.status).toBe(400);
  });
});

describe("correcting who helped", () => {
  it("changes helpedBy without touching the status", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      status: "pending",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        helpedBy: "Jordan",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ helpedBy: "Jordan", status: "pending" });
  });

  it("refuses a name longer than the field allows", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "pending",
        helpedBy: "K".repeat(81),
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("80 characters or fewer");
  });

  it("clears helpedBy when given an empty string", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        helpedBy: "",
      },
    );
    expect(res.body).toMatchObject({ helpedBy: "", status: "resolved" });
  });

  it("keeps the existing name when helpedBy is omitted", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      status: "pending",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "resolved",
      },
    );
    expect(res.body).toMatchObject({ helpedBy: "Kim", status: "resolved" });
  });

  it("keeps a name typed onto an entry that is still waiting", async () => {
    // Regression: the Edit panel sends helpedBy with no status, and a waiting
    // entry's status is already "new" — the name must not be discarded.
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        helpedBy: "Kim",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ helpedBy: "Kim", status: "new" });
  });

  it("still clears the name when an entry is reopened", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "new",
      },
    );
    expect(res.body).toMatchObject({ helpedBy: "", status: "new" });
  });

  it("blocks guests from rewriting who helped", async () => {
    const id = await join("Ada");
    const res = await request(server)
      .patch(`/api/entries/${id}`)
      .send({ helpedBy: "impostor" });
    expect(res.status).toBe(401);
  });
});

describe("admin actions", () => {
  it("flags an entry as helped and records who did it", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "resolved",
        helpedBy: "Grace",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "resolved", helpedBy: "Grace" });
    expect(res.body.updatedAt >= res.body.createdAt).toBe(true);
  });

  it("rejects a status outside new/pending/resolved", async () => {
    const id = await join("Ada");
    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "done",
      },
    );
    expect(res.status).toBe(400);
  });

  it("404s on an unknown entry", async () => {
    const res = await asAdmin(request(server).patch("/api/entries/999")).send({
      status: "pending",
    });
    expect(res.status).toBe(404);
  });

  it("exports every entry and status as CSV", async () => {
    const first = await join("Ada", "needs a laptop");
    await join("Grace");
    await asAdmin(request(server).patch(`/api/entries/${first}`)).send({
      status: "resolved",
      helpedBy: "Kim",
    });

    const res = await asAdmin(request(server).get("/api/entries.csv"));
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
    const res = await request(server).post("/api/entries").send(intake);
    expect(res.status).toBe(201);

    const rows = await store.list();
    expect(rows[0]).toMatchObject(intake);
  });

  it("keeps intake details out of the public queue", async () => {
    await request(server).post("/api/entries").send(intake);
    const res = await request(server).get("/api/queue");
    for (const field of ["dob", "gender", "phone", "caseType"]) {
      expect(res.body[0]).not.toHaveProperty(field);
    }
  });

  it("refuses an intake field that is not text rather than blanking it", async () => {
    // Trimming a number down to "" would drop a phone the client did supply.
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada", phone: 5035550142 });
    expect(res.status).toBe(400);
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects a gender outside the offered options", async () => {
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada", gender: "Woman" });
    expect(res.status).toBe(400);
  });

  it("lets staff fill in the intake fields afterwards", async () => {
    const created = await request(server)
      .post("/api/entries")
      .send({ name: "Ada" });
    const res = await asAdmin(
      request(server).patch(`/api/entries/${created.body.id}`),
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
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada", caseType: "Space Law" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed or future date of birth", async () => {
    for (const dob of ["02/04/1990", "1990-02-31", "3000-01-01"]) {
      const res = await request(server)
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

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
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
      const res = await asAdmin(
        request(server).patch(`/api/entries/${id}`),
      ).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("clears a coded field when staff pick the blank option", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      appointmentType: "Clinic",
    });

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        appointmentType: "",
      },
    );
    expect(res.body.appointmentType).toBe("");
  });

  it("leaves case fields alone when only the status changes", async () => {
    const id = await join("Ada");
    await asAdmin(request(server).patch(`/api/entries/${id}`)).send({
      legalOutcome: "CONSULT ONLY",
      timeSpent: 0.5,
    });

    const res = await asAdmin(request(server).patch(`/api/entries/${id}`)).send(
      {
        status: "resolved",
      },
    );
    expect(res.body).toMatchObject({
      legalOutcome: "CONSULT ONLY",
      timeSpent: 0.5,
    });
  });
});

describe("triage and appointments", () => {
  const book = (body: Record<string, unknown>) =>
    asAdmin(request(server).post("/api/admin/entries")).send(body);

  const queueIds = async () =>
    (await request(server).get("/api/queue")).body.map(
      (entry: { id: number }) => entry.id,
    );

  it("orders the queue by triage level before arrival", async () => {
    const first = await join("Ada");
    const second = await join("Grace");
    await asAdmin(request(server).patch(`/api/entries/${second}`)).send({
      priority: "emergency",
    });

    expect(await queueIds()).toEqual([second, first]);
  });

  it("serves the queue in arrival order within one triage level", async () => {
    const first = await join("Ada");
    const second = await join("Grace");
    expect(await queueIds()).toEqual([first, second]);
  });

  it("defaults a walk-in to routine", async () => {
    await join("Ada");
    expect((await store.list())[0].priority).toBe("routine");
  });

  it("will not let a visitor set their own triage level", async () => {
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada", priority: "emergency" });
    expect(res.status).toBe(201);
    expect((await store.list())[0].priority).toBe("routine");
  });

  it("keeps the triage level off the public board", async () => {
    await join("Ada");
    const res = await request(server).get("/api/queue");
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

    const res = await request(server).get("/api/queue");
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
    const patch = await asAdmin(
      request(server).patch(`/api/entries/${id}`),
    ).send({
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
      request(server).patch(`/api/entries/${created.body.id}`),
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

    const res = await request(server).get("/api/queue");
    expect(res.body.map((e: { due: boolean }) => e.due)).toEqual([true, false]);
  });

  it("marks an overdue appointment as due", async () => {
    await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await request(server).get("/api/queue");
    expect(res.body[0].due).toBe(true);
  });

  it("reports due-ness to the console too, so both views agree", async () => {
    await book({
      name: "Grace",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await asAdmin(request(server).get("/api/entries"));
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
      const visitor = await request(server)
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
      const res = await asAdmin(
        request(server).patch(`/api/entries/${id}`),
      ).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must be text/);
    }
  });

  it("requires the admin passcode to book someone in", async () => {
    const res = await request(server)
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
      request(server).patch(`/api/entries/${created.body.id}`),
    ).send({ scheduledFor: "" });
    expect(res.body.scheduledFor).toBe("");
  });
});
