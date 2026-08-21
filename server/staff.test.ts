import { describe, expect, it, vi } from "vitest";
import { fakeSheet } from "./sheet.fixture.js";
import {
  createStaffStore,
  fromStaffValues,
  isEmailish,
  STAFF_CACHE_MS,
  toStaffValues,
  type StaffMember,
} from "./staff.js";

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  email: "kim@clinic.org",
  role: "staff",
  addedBy: "owner@clinic.org",
  addedAt: "2026-08-20T10:00:00.000Z",
  ...over,
});

describe("the staff tab as a record format", () => {
  it("round-trips a member", () => {
    const row = member({ role: "owner" });
    expect(fromStaffValues(toStaffValues([row]))).toEqual([row]);
  });

  it("reads by header name, so a column added by hand shifts nothing", () => {
    const [header, row] = toStaffValues([member()]);
    const shifted = [
      ["note", ...header],
      ["ignore me", ...row],
    ];
    expect(fromStaffValues(shifted)[0].email).toBe("kim@clinic.org");
  });

  it("skips rows that are not addresses, so notes cannot grant access", () => {
    const [header] = toStaffValues([]);
    const rows = [
      header,
      ["not an address", "owner", "", ""],
      ["", "owner", "", ""],
      ["kim@clinic.org", "staff", "", ""],
    ];
    expect(fromStaffValues(rows).map((m) => m.email)).toEqual([
      "kim@clinic.org",
    ]);
  });

  it("falls back to the lesser role when the cell is nonsense", () => {
    const [header] = toStaffValues([]);
    const rows = [header, ["kim@clinic.org", "superuser", "", ""]];
    expect(fromStaffValues(rows)[0].role).toBe("staff");
  });

  it("lower-cases addresses so case cannot smuggle in a duplicate", () => {
    const [header] = toStaffValues([]);
    const rows = [header, ["KIM@Clinic.org", "owner", "", ""]];
    expect(fromStaffValues(rows)[0].email).toBe("kim@clinic.org");
  });
});

describe("isEmailish", () => {
  it("accepts an ordinary address and rejects the rest", () => {
    expect(isEmailish("kim@clinic.org")).toBe(true);
    expect(isEmailish("kim@clinic")).toBe(false);
    expect(isEmailish("kim clinic.org")).toBe(false);
    expect(isEmailish("a@b.org,c@d.org")).toBe(false);
    expect(isEmailish("")).toBe(false);
  });
});

describe("the staff store", () => {
  it("adds a member to the tab", async () => {
    const sheet = fakeSheet();
    const store = createStaffStore(sheet.transport);

    const added = await store.add("Kim@Clinic.org", "owner", "boss@clinic.org");
    expect(added.email).toBe("kim@clinic.org");
    expect(added.role).toBe("owner");
    expect(added.addedBy).toBe("boss@clinic.org");
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("changes the role instead of leaving two rows to disagree", async () => {
    const store = createStaffStore(fakeSheet().transport);
    await store.add("kim@clinic.org", "staff", "boss@clinic.org");
    await store.add("KIM@clinic.org", "owner", "boss@clinic.org");

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("owner");
  });

  it("removes a member regardless of the case used", async () => {
    const store = createStaffStore(fakeSheet().transport);
    await store.add("kim@clinic.org", "staff", "boss@clinic.org");

    expect(await store.remove("KIM@CLINIC.ORG")).toBe(true);
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("reports an unknown address rather than writing", async () => {
    const sheet = fakeSheet();
    const store = createStaffStore(sheet.transport);
    await store.add("kim@clinic.org", "staff", "boss@clinic.org");
    const writes = sheet.counts.write;

    expect(await store.remove("nobody@clinic.org")).toBe(false);
    expect(sheet.counts.write).toBe(writes);
  });

  it("caches the list, since every admin request consults it", async () => {
    const sheet = fakeSheet();
    const store = createStaffStore(sheet.transport);
    await store.list();
    await store.list();
    expect(sheet.counts.read).toBe(1);

    vi.useFakeTimers();
    vi.advanceTimersByTime(STAFF_CACHE_MS + 1);
    await store.list();
    expect(sheet.counts.read).toBe(2);
    vi.useRealTimers();
  });

  it("keeps concurrent grants from overwriting each other", async () => {
    const store = createStaffStore(fakeSheet().transport);
    await Promise.all([
      store.add("a@clinic.org", "staff", "boss@clinic.org"),
      store.add("b@clinic.org", "staff", "boss@clinic.org"),
      store.add("c@clinic.org", "staff", "boss@clinic.org"),
    ]);
    await expect(store.list()).resolves.toHaveLength(3);
  });
});
