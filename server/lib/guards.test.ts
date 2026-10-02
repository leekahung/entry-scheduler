import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "./auth.js";
import { createGuards } from "./guards.js";
import type { Req } from "./http.js";
import type { StaffStore } from "../domain/staff.js";

const OAUTH = {
  GOOGLE_OAUTH_CLIENT_ID: "client-123",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret-123",
  SESSION_SECRET: "a-long-signing-secret",
  ADMIN_EMAILS: "boss@clinic.org",
};

/** A request carrying a session cookie, enough for `identify`. */
const signedIn = (email: string) => {
  const cookie = `${SESSION_COOKIE}=${signSession(email, OAUTH.SESSION_SECRET)}`;
  return {
    header: (name: string) => (name === "cookie" ? cookie : undefined),
  } as unknown as Req;
};

describe("who a request is", () => {
  beforeEach(() => {
    Object.assign(process.env, OAUTH);
  });
  afterEach(() => {
    for (const key of Object.keys(OAUTH)) delete process.env[key];
  });

  // A guard and then the route both ask; the staff list is read once.
  it("is worked out once per request, however often it is asked", async () => {
    let reads = 0;
    const staff = {
      list: async () => {
        reads += 1;
        return [
          { email: "kim@clinic.org", role: "owner", addedBy: "", addedAt: "" },
        ];
      },
    } as unknown as StaffStore;
    const { identify } = createGuards({
      adminPasscode: "",
      allowRemoteAdmin: false,
      staff,
      trustsProxy: () => false,
    });

    const req = signedIn("kim@clinic.org");
    expect(await identify(req)).toEqual({
      email: "kim@clinic.org",
      role: "owner",
    });
    expect(await identify(req)).toEqual({
      email: "kim@clinic.org",
      role: "owner",
    });
    expect(reads).toBe(1);

    // A different request is its own question.
    await identify(signedIn("kim@clinic.org"));
    expect(reads).toBe(2);
  });
});
