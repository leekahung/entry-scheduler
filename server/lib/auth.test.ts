import { describe, expect, it } from "vitest";
import {
  authConfig,
  cookie,
  isBootstrapOwner,
  parseAllowlist,
  readCookie,
  readSession,
  SESSION_MS,
  sessionName,
  signSession,
} from "./auth.js";

const COMPLETE = {
  GOOGLE_OAUTH_CLIENT_ID: "client-123",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
  SESSION_SECRET: "a-long-signing-secret",
  ADMIN_EMAILS: "Kim@Clinic.org, sam@clinic.org",
};

describe("authConfig", () => {
  it("is null unless every part is set, so a half-configured console still opens", () => {
    expect(authConfig({})).toBeNull();
    expect(
      authConfig({ ...COMPLETE, GOOGLE_OAUTH_CLIENT_SECRET: "" }),
    ).toBeNull();
    expect(authConfig({ ...COMPLETE, SESSION_SECRET: "  " })).toBeNull();
    expect(authConfig(COMPLETE)).not.toBeNull();
  });

  it("reads the allowlist case-insensitively", () => {
    const config = authConfig(COMPLETE);
    expect(config && isBootstrapOwner(config, "KIM@clinic.org")).toBe(true);
    expect(config && isBootstrapOwner(config, " sam@clinic.org ")).toBe(true);
    expect(config && isBootstrapOwner(config, "stranger@clinic.org")).toBe(
      false,
    );
  });
});

describe("parseAllowlist", () => {
  it("ignores blanks and stray commas rather than admitting an empty address", () => {
    expect(parseAllowlist(" a@b.org ,, c@d.org, ")).toEqual(
      new Set(["a@b.org", "c@d.org"]),
    );
    expect(parseAllowlist(undefined).size).toBe(0);
  });

  it("admits nobody when unset, so a missing list cannot open the console", () => {
    const config = authConfig({ ...COMPLETE, ADMIN_EMAILS: "" });
    expect(config?.allowed.size).toBe(0);
    expect(config && isBootstrapOwner(config, "kim@clinic.org")).toBe(false);
  });
});

describe("session tokens", () => {
  const secret = "signing-secret";

  it("round-trips the signed-in address", () => {
    const token = signSession("kim@clinic.org", secret);
    expect(readSession(token, secret)).toBe("kim@clinic.org");
  });

  it("refuses a token signed with a different secret", () => {
    const token = signSession("kim@clinic.org", "other-secret");
    expect(readSession(token, secret)).toBeNull();
  });

  it("refuses a token whose payload was edited", () => {
    const token = signSession("kim@clinic.org", secret);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ email: "attacker@evil.org", exp: Date.now() + 1000 }),
    ).toString("base64url");
    expect(readSession(`${forged}.${signature}`, secret)).toBeNull();
  });

  it("expires rather than lasting forever", () => {
    const token = signSession("kim@clinic.org", secret);
    expect(readSession(token, secret, Date.now() + SESSION_MS + 1)).toBeNull();
  });

  it("treats junk as a rejection rather than throwing", () => {
    for (const junk of [undefined, "", "no-dot", "a.b", "...", "%%%.%%%"]) {
      expect(readSession(junk, secret)).toBeNull();
    }
  });
});

describe("cookies", () => {
  it("finds one cookie among several", () => {
    expect(
      readCookie("a=1; admin_session=tok%20en; b=2", "admin_session"),
    ).toBe("tok en");
    expect(readCookie("a=1", "admin_session")).toBeUndefined();
    expect(readCookie(undefined, "admin_session")).toBeUndefined();
  });

  it("marks the session cookie HttpOnly and SameSite, and Secure over https", () => {
    const set = cookie("admin_session", "value", {
      maxAge: 60_000,
      secure: true,
    });
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Secure");
    expect(set).toContain("Max-Age=60");
  });

  it("leaves Secure off for plain-http LAN use", () => {
    expect(
      cookie("admin_session", "v", { maxAge: 1000, secure: false }),
    ).not.toContain("Secure");
  });
});

describe("the name a session carries", () => {
  const SECRET = "a-long-signing-secret";

  it("hands back the name it was signed with", () => {
    const token = signSession("kim@clinic.org", SECRET, undefined, "Kim Ng");
    expect(sessionName(token, SECRET)).toBe("Kim Ng");
    expect(readSession(token, SECRET)).toBe("kim@clinic.org");
  });

  it("reads a session signed before names were carried", () => {
    const token = signSession("kim@clinic.org", SECRET);
    expect(sessionName(token, SECRET)).toBe("");
    expect(readSession(token, SECRET)).toBe("kim@clinic.org");
  });

  it("gives nothing for a forged or expired token", () => {
    const token = signSession("kim@clinic.org", SECRET, undefined, "Kim Ng");
    expect(sessionName(token, "not-the-secret")).toBe("");
    expect(sessionName(token, SECRET, Date.now() + SESSION_MS + 1)).toBe("");
  });
});
