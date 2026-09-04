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
import {
  SESSION_COOKIE,
  SESSION_MS,
  signSession,
  STATE_COOKIE,
} from "../lib/auth.js";
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
    expect((await request(server).get("/api/auth/mode")).body).toEqual({
      google: false,
    });
    enable();
    expect((await request(server).get("/api/auth/mode")).body).toEqual({
      google: true,
    });
  });

  it("stops accepting the shared passcode once Google is configured", async () => {
    enable();
    const res = await asAdmin(request(server).get("/api/entries"));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Sign in with Google to continue." });
  });

  it("lets an allowlisted address through on its session cookie", async () => {
    enable();
    const res = await request(server)
      .get("/api/entries")
      .set("cookie", sessionFor("kim@clinic.org"));
    expect(res.status).toBe(200);
  });

  it("refuses a valid session for an address off the allowlist", async () => {
    enable();
    const res = await request(server)
      .get("/api/entries")
      .set("cookie", sessionFor("stranger@clinic.org"));
    expect(res.status).toBe(401);
  });

  it("refuses an expired session", async () => {
    enable();
    const stale = sessionFor("kim@clinic.org", Date.now() - SESSION_MS - 1000);
    const res = await request(server).get("/api/entries").set("cookie", stale);
    expect(res.status).toBe(401);
  });

  it("refuses a session cookie signed with the wrong secret", async () => {
    enable();
    const forged = `${SESSION_COOKIE}=${signSession("kim@clinic.org", "not-the-secret")}`;
    const res = await request(server).get("/api/entries").set("cookie", forged);
    expect(res.status).toBe(401);
  });

  it("reports who is signed in, and 401s when nobody is", async () => {
    enable();
    expect((await request(server).get("/api/auth/me")).status).toBe(401);
    const res = await request(server)
      .get("/api/auth/me")
      .set("cookie", sessionFor("kim@clinic.org"));
    expect(res.body.email).toBe("kim@clinic.org");
  });

  it("sends staff to Google with a state cookie to come back with", async () => {
    enable();
    const res = await request(server).get("/api/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
    expect(res.headers.location).toContain("client-123");
    expect(res.headers["set-cookie"][0]).toContain(STATE_COOKIE);
    // Without "profile" Google sends no display name, and every entry would be
    // credited to an email address instead of a person.
    expect(decodeURIComponent(res.headers.location)).toContain("profile");
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    enable();
    const res = await request(server)
      .get("/api/auth/callback?code=abc&state=forged")
      .set("cookie", `${STATE_COOKIE}=genuine`);
    // Redirected back to the console with something readable, not raw JSON.
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("authError=");
    expect(res.headers.location).toContain("#/admin");
  });

  it("refuses a callback carrying no code at all", async () => {
    enable();
    const res = await request(server).get("/api/auth/callback?state=x");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("authError=");
  });

  it("clears the session cookie on sign-out", async () => {
    enable();
    const res = await request(server).post("/api/auth/logout");
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
