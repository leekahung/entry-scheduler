import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import request from "supertest";
import { createApp } from "./app.js";
import { isLocalAddress } from "./lib/net.js";
import { fakeSheet } from "./sheet/sheet.fixture.js";
import { createStaffStore } from "./domain/staff.js";
import { createStore, type Store } from "./sheet/store.js";
import { SESSION_COOKIE, signSession } from "./lib/auth.js";

const PASSCODE = "test-passcode";
const asAdmin = (req: request.Test) => req.set("x-admin-passcode", PASSCODE);

let store: Store;
let app: ReturnType<typeof createApp>;
// One listener for the whole file, delegating to whichever app the current
// test built. `request(app)` would open an ephemeral port per call, and even
// binding one per test churned enough of them that a request occasionally
// landed on a reused port and came back as someone else's answer.
const server = createServer((req, res) => app(req, res));

const emptyStore = () => createStore(fakeSheet().transport);

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

describe("admin gate", () => {
  it("blocks status changes without the passcode", async () => {
    const id = await join("Ada");
    const res = await request(server)
      .patch(`/api/entries/${id}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(401);
    const [entry] = await store.list();
    expect(entry.status).toBe("new");
  });

  it("blocks status changes with a wrong passcode", async () => {
    const id = await join("Ada");
    const res = await request(server)
      .patch(`/api/entries/${id}`)
      .set("x-admin-passcode", "wrong")
      .send({ status: "resolved" });
    expect(res.status).toBe(401);
  });

  it("blocks CSV export and full records without the passcode", async () => {
    await join("Ada");
    expect((await request(server).get("/api/entries.csv")).status).toBe(401);
    expect((await request(server).get("/api/entries")).status).toBe(401);
  });

  it("blocks saving to the month tabs without the passcode", async () => {
    expect((await request(server).post("/api/entries/archive")).status).toBe(
      401,
    );
  });

  it("blocks deletion without the passcode", async () => {
    const id = await join("Ada");
    expect((await request(server).delete(`/api/entries/${id}`)).status).toBe(
      401,
    );
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects every admin request when no passcode is configured", async () => {
    const openApp = createApp(emptyStore(), "");
    expect((await request(openApp).get("/api/entries.csv")).status).toBe(401);
  });

  it("refuses the passcode outright in production, however right it is", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const deployed = createApp(emptyStore(), PASSCODE);
      const res = await asAdmin(request(deployed).get("/api/entries.csv"));
      // Not 401, which would read as "wrong passcode" and invite another
      // guess: this deployment has no passcode to get right.
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/Google sign-in/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("still lets the passcode work outside production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const local = createApp(emptyStore(), PASSCODE);
      expect(
        (await asAdmin(request(local).get("/api/entries.csv"))).status,
      ).toBe(200);
    } finally {
      process.env.NODE_ENV = previous;
    }
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
    mkdirSync(path.join(staticDir, "assets"));
    writeFileSync(
      path.join(staticDir, "assets", "index-abc123.js"),
      "console.log('fingerprinted');",
    );
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

  it("lets a fingerprinted asset be kept, so a reload does not refetch it", async () => {
    const res = await request(served).get("/assets/index-abc123.js");
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("never holds a file that is not fingerprinted, whatever its type", async () => {
    // Anything copied into the build unhashed keeps its name across builds —
    // held for a year, it could never be replaced.
    const res = await request(served).get("/app.js");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("never lets index.html be kept, since it names the current assets", async () => {
    // Both the root and the deep links staff actually open: the fallback does
    // not go through the static handler, so it needs the rule of its own.
    for (const route of ["/", "/admin"]) {
      const res = await request(served).get(route);
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
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

describe("hardening", () => {
  it("throttles repeated failed admin attempts", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (
        await request(server)
          .post("/api/admin/verify")
          .set("x-admin-passcode", `guess-${i}`)
      ).status;
    }
    expect(last).toBe(429);
  });

  it("does not throttle admin requests that succeed", async () => {
    for (let i = 0; i < 40; i++) {
      expect((await asAdmin(request(server).get("/api/entries"))).status).toBe(
        200,
      );
    }
  });

  it("throttles a flood of sign-ins from one address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 105; i++) {
      statuses.push(
        (
          await request(server)
            .post("/api/entries")
            .send({ name: `Flood ${i}` })
        ).status,
      );
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
    const res = await request(server)
      .post("/api/entries")
      .set("Content-Type", "application/json")
      .send("{bad json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Bad request." });
    expect(res.text).not.toContain("SyntaxError");
    expect(res.text).not.toContain(".ts:");
  });

  it("keeps API answers out of any cache but the reader's own", async () => {
    const res = await request(server).get("/api/queue");
    // `no-cache` alone still permits a shared cache to store the response and
    // revalidate it; these carry visitors' names.
    expect(res.headers["cache-control"]).toBe("private, no-cache");
  });

  it("sets framing and sniffing protections, and hides the server stack", async () => {
    const res = await request(server).get("/api/queue");
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

describe("behind an unconfigured proxy", () => {
  // Cloud Run and most reverse proxies hand the container a private address as
  // the peer, so without `trust proxy` every caller would look on-site.
  // The shared app, which is never told to trust a proxy.
  const fromInternet = (path: string) =>
    request(server)
      .get(path)
      .set("x-admin-passcode", PASSCODE)
      .set("x-forwarded-for", "203.0.113.7");

  it("refuses admin requests carrying a forwarded header it was not told to trust", async () => {
    const res = await fromInternet("/api/entries");
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

  it("keeps every filed month to owners, though staff may take the board", async () => {
    const SECRET = "a-long-signing-secret-of-adequate-length";
    Object.assign(process.env, {
      GOOGLE_OAUTH_CLIENT_ID: "client-123",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
      SESSION_SECRET: SECRET,
      ADMIN_EMAILS: "boss@clinic.org",
    });
    try {
      const staff = createStaffStore(fakeSheet().transport);
      // A staff member who is not on ADMIN_EMAILS, so the console knows them
      // but not as an owner.
      await staff.add("helper@clinic.org", "staff", "boss@clinic.org");
      const app = createApp(emptyStore(), PASSCODE, undefined, false, {
        staff,
      });
      const signedIn = (email: string) => (req: request.Test) =>
        req.set("cookie", `${SESSION_COOKIE}=${signSession(email, SECRET)}`);

      // Not on the owner list, so this session is staff.
      const asStaff = signedIn("helper@clinic.org");
      const asOwner = signedIn("boss@clinic.org");

      // The board is what they are already looking at.
      expect((await asStaff(request(app).get("/api/entries.csv"))).status).toBe(
        200,
      );
      // Every name, date of birth and note the clinic has ever filed is not.
      const refused = await asStaff(request(app).get("/api/entries.xlsx"));
      expect(refused.status).toBe(403);
      expect(
        (await asOwner(request(app).get("/api/entries.xlsx"))).status,
      ).toBe(200);
    } finally {
      for (const key of [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "SESSION_SECRET",
        "ADMIN_EMAILS",
      ]) {
        delete process.env[key];
      }
    }
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
    expect((await asAdmin(request(server).get("/api/entries"))).status).toBe(
      200,
    );
  });

  // Enforcement itself is covered by the sign-in flood in "hardening", which
  // shares this limiter. Exhausting a 1200-request budget here only made the
  // test slow enough to drop a request and fail on a loaded machine.
  it("budgets the board for a roomful, not for one device", async () => {
    const res = await request(server).get("/api/queue");
    expect(Number(res.headers["ratelimit-limit"])).toBe(1200);
  });

  it("counts every board request against that budget", async () => {
    const first = await request(server).get("/api/queue");
    const second = await request(server).get("/api/queue");
    expect(Number(second.headers["ratelimit-remaining"])).toBe(
      Number(first.headers["ratelimit-remaining"]) - 1,
    );
  });

  it("leaves a roomful of polling visitors alone behind one address", async () => {
    // 10 visitors x 12 polls a minute, all sharing a NAT or proxy address.
    for (let i = 0; i < 120; i++) {
      expect((await request(server).get("/api/queue")).status).toBe(200);
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
