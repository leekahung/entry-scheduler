import { describe, expect, it } from "vitest";
import { AUTH_ERRORS, authErrorMessage } from "./authErrors.js";

describe("authErrorMessage", () => {
  it("gives each known code its own message", () => {
    expect(authErrorMessage("unverified")).toBe(AUTH_ERRORS.unverified);
    expect(authErrorMessage("unconfirmed")).toBe(AUTH_ERRORS.unconfirmed);
  });

  it("names the address an unlisted account signed in with", () => {
    expect(authErrorMessage("notListed", "ada@example.org")).toBe(
      "ada@example.org is not on the staff list for this console.",
    );
  });

  it("never shows text a crafted link chose", () => {
    const planted = "Your access is suspended. Call IT at 555-0142.";
    expect(authErrorMessage(planted)).toBe("Sign-in failed. Please try again.");
    expect(authErrorMessage("notListed", planted)).toBe(AUTH_ERRORS.notListed);
  });

  it("does not treat inherited object keys as codes", () => {
    expect(authErrorMessage("toString")).toBe(
      "Sign-in failed. Please try again.",
    );
  });
});
