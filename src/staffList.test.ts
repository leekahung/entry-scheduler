import { describe, expect, it } from "vitest";
import type { StaffList, StaffMember } from "./api";
import { duplicateReason } from "./staffList";

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  email: "kim@clinic.org",
  role: "staff",
  addedBy: "boss@clinic.org",
  addedAt: "2026-08-20T10:00:00.000Z",
  ...over,
});

const list = (over: Partial<StaffList> = {}): StaffList => ({
  you: { email: "boss@clinic.org", role: "owner" },
  bootstrapOwners: [],
  redundantRows: [],
  members: [],
  ...over,
});

describe("adding someone already on the staff list", () => {
  it("lets a new address through", () => {
    expect(duplicateReason(list(), "sam@clinic.org", "staff")).toBeNull();
  });

  it("stops an add that would change nothing", () => {
    const reason = duplicateReason(
      list({ members: [member()] }),
      "kim@clinic.org",
      "staff",
    );
    expect(reason).toContain("already on the list");
  });

  it("allows a re-add that changes the role, which is how a role is changed", () => {
    expect(
      duplicateReason(list({ members: [member()] }), "kim@clinic.org", "owner"),
    ).toBeNull();
  });

  it("stops an address the environment already owns, whatever the role", () => {
    const owners = list({ bootstrapOwners: ["boss@clinic.org"] });
    for (const role of ["staff", "owner"] as const) {
      expect(duplicateReason(owners, "boss@clinic.org", role)).toContain(
        "set on the server",
      );
    }
  });

  it("names the role it already holds, so the message says why nothing happened", () => {
    const reason = duplicateReason(
      list({ members: [member({ role: "owner" })] }),
      "kim@clinic.org",
      "owner",
    );
    expect(reason).toContain("an owner");
  });
});
