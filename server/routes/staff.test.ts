import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createServer } from "node:http";
import request from "supertest";
import { createApp } from "../app.js";
import { fakeSheet } from "../sheet/sheet.fixture.js";
import {
  createStaffStore,
  type StaffMember,
  type StaffStore,
} from "../domain/staff.js";
import type { Store } from "../sheet/store.js";
import { SESSION_COOKIE, signSession } from "../lib/auth.js";
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

describe("managing who has access", () => {
  const OAUTH = {
    GOOGLE_OAUTH_CLIENT_ID: "client-123",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
    SESSION_SECRET: "a-long-signing-secret",
    ADMIN_EMAILS: "boss@clinic.org",
  };

  let staff: StaffStore;
  let withStaff: ReturnType<typeof createApp>;
  // Its own long-lived listener, for the same reason as the shared one above.
  const withStaffServer = createServer((req, res) => withStaff(req, res));

  const as = (email: string) =>
    `${SESSION_COOKIE}=${signSession(email, OAUTH.SESSION_SECRET)}`;

  beforeEach(() => {
    Object.assign(process.env, OAUTH);
    staff = createStaffStore(fakeSheet().transport);
    withStaff = createApp(store, PASSCODE, undefined, false, { staff });
  });

  beforeAll(
    () =>
      new Promise((ready) => withStaffServer.listen(0, () => ready(undefined))),
  );
  afterAll(
    () => new Promise((done) => withStaffServer.close(() => done(undefined))),
  );

  afterEach(() => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
  });

  it("keeps the records to owners: a staff session cannot save the month tabs", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");

    const refused = await request(withStaffServer)
      .post("/api/entries/archive")
      .set("cookie", as("kim@clinic.org"));
    expect(refused.status).toBe(403);

    const allowed = await request(withStaffServer)
      .post("/api/entries/archive")
      .set("cookie", as("boss@clinic.org"));
    expect(allowed.status).toBe(200);
  });

  it("withholds the spreadsheet link from staff on /api/admin/verify", async () => {
    process.env.GOOGLE_SHEETS_ID = "sheet-123";
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");

    const asStaff = await request(withStaffServer)
      .post("/api/admin/verify")
      .set("cookie", as("kim@clinic.org"));
    expect(asStaff.body).toMatchObject({ ok: true, sheetUrl: null });

    const asOwner = await request(withStaffServer)
      .post("/api/admin/verify")
      .set("cookie", as("boss@clinic.org"));
    expect(asOwner.body.sheetUrl).toContain("sheet-123");
    delete process.env.GOOGLE_SHEETS_ID;
  });

  it("still hands the link out on a passcode deployment, which has no owners", async () => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
    process.env.GOOGLE_SHEETS_ID = "sheet-123";
    const res = await asAdmin(
      request(withStaffServer).post("/api/admin/verify"),
    );
    expect(res.body.sheetUrl).toContain("sheet-123");
    delete process.env.GOOGLE_SHEETS_ID;
  });

  it("has no name to give when Google sent none, leaving the email to stand in", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    // A session signed without a name: an account with no display name set,
    // or one issued before the profile scope was asked for.
    const res = await request(withStaffServer)
      .get("/api/auth/me")
      .set("cookie", as("kim@clinic.org"));
    expect(res.body).toMatchObject({ email: "kim@clinic.org", name: "" });
  });

  it("gives the display name when Google sent one", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    const named = `${SESSION_COOKIE}=${signSession("kim@clinic.org", OAUTH.SESSION_SECRET, undefined, "Kim Ng")}`;
    const res = await request(withStaffServer)
      .get("/api/auth/me")
      .set("cookie", named);
    expect(res.body).toMatchObject({ email: "kim@clinic.org", name: "Kim Ng" });
  });

  it("keeps the sign-in warning to owners", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    expect(
      (
        await request(withStaffServer)
          .get("/api/admin/alerts")
          .set("cookie", as("kim@clinic.org"))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(withStaffServer)
          .get("/api/admin/alerts")
          .set("cookie", as("boss@clinic.org"))
      ).status,
    ).toBe(200);
  });

  it("withholds the spreadsheet link from staff on /api/auth/me", async () => {
    process.env.GOOGLE_SHEETS_ID = "sheet-123";
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");

    const asStaff = await request(withStaffServer)
      .get("/api/auth/me")
      .set("cookie", as("kim@clinic.org"));
    expect(asStaff.body).toMatchObject({ role: "staff", sheetUrl: null });

    const asOwner = await request(withStaffServer)
      .get("/api/auth/me")
      .set("cookie", as("boss@clinic.org"));
    expect(asOwner.body.sheetUrl).toContain("sheet-123");
    delete process.env.GOOGLE_SHEETS_ID;
  });

  it("still lets staff work the queue and take their own current-list export", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    const id = await join("Ada");

    const worked = await request(withStaffServer)
      .patch(`/api/entries/${id}`)
      .set("cookie", as("kim@clinic.org"))
      .send({ status: "pending" });
    expect(worked.status).toBe(200);

    const exported = await request(withStaffServer)
      .get("/api/entries/current.xlsx")
      .set("cookie", as("kim@clinic.org"));
    expect(exported.status).toBe(200);
  });

  it("draws no owner line on a passcode deployment, which has none", async () => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
    const res = await asAdmin(
      request(withStaffServer).post("/api/entries/archive"),
    );
    expect(res.status).toBe(200);
  });

  it("is unavailable without Google sign-in, so a shared passcode cannot grant access", async () => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
    const res = await asAdmin(request(withStaffServer).get("/api/admin/staff"));
    expect(res.status).toBe(501);
  });

  it("lets an owner from the environment read the list", async () => {
    const res = await request(withStaffServer)
      .get("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"));
    expect(res.status).toBe(200);
    expect(res.body.you).toEqual({ email: "boss@clinic.org", role: "owner" });
    expect(res.body.bootstrapOwners).toEqual(["boss@clinic.org"]);
  });

  it("lets an owner grant and revoke console access", async () => {
    const added = await request(withStaffServer)
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
        await request(withStaffServer)
          .get("/api/entries")
          .set("cookie", as("kim@clinic.org"))
      ).status,
    ).toBe(200);

    const removed = await request(withStaffServer)
      .delete("/api/admin/staff/kim@clinic.org")
      .set("cookie", as("boss@clinic.org"));
    expect(removed.status).toBe(204);

    // And is locked out again straight away.
    expect(
      (
        await request(withStaffServer)
          .get("/api/entries")
          .set("cookie", as("kim@clinic.org"))
      ).status,
    ).toBe(401);
  });

  it("refuses a plain staff member the ability to grant access", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    const res = await request(withStaffServer)
      .post("/api/admin/staff")
      .set("cookie", as("kim@clinic.org"))
      .send({ email: "friend@clinic.org", role: "owner" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Only an owner can change who has access.",
    });
  });

  it("refuses a signed-out caller entirely", async () => {
    const res = await request(withStaffServer).get("/api/admin/staff");
    expect(res.status).toBe(401);
  });

  it("lets an owner added to the sheet manage the list too", async () => {
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaffServer)
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
      const res = await request(withStaffServer)
        .post("/api/admin/staff")
        .set("cookie", as("boss@clinic.org"))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it("lists a server-set owner once and names their leftover row", async () => {
    await staff.add("boss@clinic.org", "staff", "boss@clinic.org");
    const res = await request(withStaffServer)
      .get("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"));
    expect(res.body.bootstrapOwners).toEqual(["boss@clinic.org"]);
    // Listed as an owner above, so listing the row here too would show the
    // same address twice — but it still has to be named as removable.
    expect(res.body.members.map((m: StaffMember) => m.email)).not.toContain(
      "boss@clinic.org",
    );
    expect(res.body.redundantRows).toEqual(["boss@clinic.org"]);
  });

  it("clears a leftover row without taking the environment's access away", async () => {
    await staff.add("boss@clinic.org", "staff", "boss@clinic.org");
    const res = await request(withStaffServer)
      .delete("/api/admin/staff/boss@clinic.org")
      .set("cookie", as("boss@clinic.org"));
    expect(res.status).toBe(204);
    expect(await staff.list()).toEqual([]);

    // The environment still grants the access the row was shadowing.
    const still = await request(withStaffServer)
      .get("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"));
    expect(still.status).toBe(200);
    expect(still.body.redundantRows).toEqual([]);
  });

  it("will not let an owner remove their own access", async () => {
    // An owner from the tab, not the environment: an environment owner keeps
    // their access whatever the tab says, so removing their row is allowed.
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaffServer)
      .delete("/api/admin/staff/kim@clinic.org")
      .set("cookie", as("kim@clinic.org"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("your own access");
  });

  it("will not let a server-set owner be removed through the console", async () => {
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaffServer)
      .delete("/api/admin/staff/boss@clinic.org")
      .set("cookie", as("kim@clinic.org"));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("set on the server");
  });

  it("404s an address that was never on the list", async () => {
    const res = await request(withStaffServer)
      .delete("/api/admin/staff/nobody@clinic.org")
      .set("cookie", as("boss@clinic.org"));
    expect(res.status).toBe(404);
  });

  it("will not add a row for an address the environment already owns", async () => {
    const res = await request(withStaffServer)
      .post("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"))
      .send({ email: "boss@clinic.org", role: "staff" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("set on the server");
  });

  // Removing yourself was already refused; re-adding yourself as staff is the
  // same mistake reached through the add form, and the last owner to make it
  // leaves nobody able to undo it.
  it("will not let an owner make themselves staff", async () => {
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaffServer)
      .post("/api/admin/staff")
      .set("cookie", as("kim@clinic.org"))
      .send({ email: "kim@clinic.org", role: "staff" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("your own access");

    const still = await request(withStaffServer)
      .get("/api/admin/staff")
      .set("cookie", as("kim@clinic.org"));
    expect(still.body.members[0].role).toBe("owner");
  });

  it("still lets an owner raise somebody else, and themselves, to owner", async () => {
    await staff.add("kim@clinic.org", "owner", "boss@clinic.org");
    const res = await request(withStaffServer)
      .post("/api/admin/staff")
      .set("cookie", as("kim@clinic.org"))
      .send({ email: "kim@clinic.org", role: "owner" });
    expect(res.status).toBe(201);
  });

  it("changes a role rather than duplicating the row", async () => {
    await staff.add("kim@clinic.org", "staff", "boss@clinic.org");
    await request(withStaffServer)
      .post("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"))
      .send({ email: "kim@clinic.org", role: "owner" });

    const res = await request(withStaffServer)
      .get("/api/admin/staff")
      .set("cookie", as("boss@clinic.org"));
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].role).toBe("owner");
  });
});
