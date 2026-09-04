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

describe("the spreadsheet link", () => {
  afterEach(() => {
    delete process.env.GOOGLE_SHEETS_ID;
  });

  it("hands the console the spreadsheet to link to once Sheets is configured", async () => {
    process.env.GOOGLE_SHEETS_ID = "sheet-123";

    const res = await asAdmin(request(server).post("/api/admin/verify"));
    expect(res.body.sheetUrl).toBe(
      "https://docs.google.com/spreadsheets/d/sheet-123/edit",
    );
  });

  it("returns no link when Sheets is unconfigured, so the console offers the CSV instead", async () => {
    const res = await asAdmin(request(server).post("/api/admin/verify"));
    expect(res.body).toEqual({ ok: true, sheetUrl: null });
  });
});

describe("failed sign-in warnings", () => {
  it("reports nothing when every request has been authorised", async () => {
    const res = await asAdmin(request(server).get("/api/admin/alerts"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ failedAttempts: 0, lastAttemptAt: null });
  });

  it("counts failed attempts and timestamps the most recent one", async () => {
    for (const guess of ["a", "b", "c"]) {
      await request(server)
        .post("/api/admin/verify")
        .set("x-admin-passcode", guess);
    }

    const res = await asAdmin(request(server).get("/api/admin/alerts"));
    expect(res.body.failedAttempts).toBe(3);
    expect(res.body.windowMinutes).toBe(15);
    expect(Date.parse(res.body.lastAttemptAt)).toBeLessThanOrEqual(Date.now());
  });

  it("keeps the alert feed behind the passcode", async () => {
    const res = await request(server).get("/api/admin/alerts");
    expect(res.status).toBe(401);
  });

  it("tells a rejected caller how many attempts remain", async () => {
    const res = await request(server)
      .post("/api/admin/verify")
      .set("x-admin-passcode", "wrong");

    expect(res.status).toBe(401);
    // The sign-in screen counts down from this header.
    expect(Number(res.headers["ratelimit-remaining"])).toBe(29);
  });
});
