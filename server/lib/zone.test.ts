import { afterEach, describe, expect, it } from "vitest";
import { applyClinicZone } from "./zone.js";

const held = process.env.TZ;

/** Puts back whatever the runner was started with, unset included. */
afterEach(() => {
  if (held === undefined) delete process.env.TZ;
  else process.env.TZ = held;
});

describe("the zone the books are kept in", () => {
  it("pins a host that names no zone to the clinic's own", () => {
    delete process.env.TZ;
    expect(applyClinicZone()).toBe("America/Los_Angeles");
    expect(process.env.TZ).toBe("America/Los_Angeles");
  });

  it("leaves a zone the deployment named alone", () => {
    process.env.TZ = "America/New_York";
    expect(applyClinicZone()).toBe("America/New_York");
  });

  it("files a late evening into the month it was taken in", () => {
    // The bug this exists for: 11:30pm Pacific on the last of September is
    // already October in UTC, and the row was filed a month ahead.
    delete process.env.TZ;
    applyClinicZone();
    const at = new Date("2026-09-30T23:30:00-07:00");
    expect(at.getMonth() + 1).toBe(9);
    expect(at.getDate()).toBe(30);
  });
});
