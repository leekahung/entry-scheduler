import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import request from "supertest";
import { createApp } from "../app.js";
import { publicName } from "../domain/publicEntry.js";
import type { Store } from "../sheet/store.js";
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

describe("public access", () => {
  it("lets anyone join the queue with just a name", async () => {
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Ada", status: "new" });
  });

  it("rejects a blank or whitespace-only name", async () => {
    for (const name of ["", "   "]) {
      const res = await request(server).post("/api/entries").send({ name });
      expect(res.status).toBe(400);
    }
  });

  it("hides admin bookkeeping fields from the public queue", async () => {
    await join("Ada");
    const res = await request(server).get("/api/queue");
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty("helpedBy");
    expect(res.body[0]).not.toHaveProperty("note");
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

    const publicRes = await request(server).get("/api/queue");
    expect(publicRes.body[0].name).toBe("Ada L.");
    expect(publicRes.text).not.toContain("Lovelace");

    const adminRes = await asAdmin(request(server).get("/api/entries"));
    expect(adminRes.body[0].name).toBe("Ada Lovelace");
  });

  it("returns the full name to the visitor who just joined", async () => {
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada Lovelace" });
    expect(res.body.name).toBe("Ada Lovelace");
  });
});

describe("leaving the queue", () => {
  it("gives visitors no way to remove themselves", async () => {
    const id = await join("Ada");
    const res = await request(server)
      .post(`/api/entries/${id}/cancel`)
      .send({});
    expect(res.status).toBe(404);
    expect(await store.list()).toHaveLength(1);
  });

  it("hands out nothing a visitor could delete with", async () => {
    const res = await request(server)
      .post("/api/entries")
      .send({ name: "Ada" });
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
    const res = await asAdmin(request(server).delete(`/api/entries/${id}`));
    expect(res.status).toBe(204);
    expect(await store.list()).toHaveLength(0);
  });
});
