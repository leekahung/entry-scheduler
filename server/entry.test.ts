import { describe, expect, it } from "vitest";
import { isDue, queueOrder } from "./entry.js";
import { makeEntry } from "./entry.fixture.js";

// A fixed clock, so the moment an appointment comes due is exact rather than
// "about now" — the route tests can only approximate it with real time.
const NOON = Date.parse("2026-08-17T12:00:00.000Z");
const at = (iso: string) => Date.parse(iso);

const order = (entries: ReturnType<typeof makeEntry>[]) =>
  [...entries].sort(queueOrder(NOON)).map((entry) => entry.id);

describe("isDue", () => {
  it("treats a walk-in as due the moment it exists", () => {
    expect(isDue(makeEntry({ scheduledFor: "" }), NOON)).toBe(true);
  });

  it("is due exactly at the appointment time, not a moment later", () => {
    const entry = makeEntry({ scheduledFor: "2026-08-17T12:00:00.000Z" });
    expect(isDue(entry, NOON)).toBe(true);
    expect(isDue(entry, NOON - 1)).toBe(false);
  });
});

describe("queueOrder", () => {
  it("puts a more urgent entry first", () => {
    expect(
      order([
        makeEntry({ id: 1, createdAt: "2026-08-17T09:00:00.000Z" }),
        makeEntry({
          id: 2,
          priority: "emergency",
          createdAt: "2026-08-17T11:00:00.000Z",
        }),
      ]),
    ).toEqual([2, 1]);
  });

  it("keeps arrival order within one triage level", () => {
    expect(
      order([
        makeEntry({ id: 2, createdAt: "2026-08-17T10:00:00.000Z" }),
        makeEntry({ id: 1, createdAt: "2026-08-17T09:00:00.000Z" }),
      ]),
    ).toEqual([1, 2]);
  });

  it("slots an appointment in by its start time, not its booking time", () => {
    expect(
      order([
        makeEntry({ id: 1, createdAt: "2026-08-17T09:00:00.000Z" }),
        // Booked days ago for 10am — belongs after the 9am walk-in.
        makeEntry({
          id: 2,
          createdAt: "2026-08-10T08:00:00.000Z",
          scheduledFor: "2026-08-17T10:00:00.000Z",
        }),
        makeEntry({ id: 3, createdAt: "2026-08-17T11:00:00.000Z" }),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("holds an undue appointment at the back whatever its triage", () => {
    const walkIn = makeEntry({ id: 1, createdAt: "2026-08-17T11:00:00.000Z" });
    const undue = makeEntry({
      id: 2,
      priority: "emergency",
      scheduledFor: "2026-08-17T15:00:00.000Z",
    });

    // Asserted on the comparator in both directions, not via sort(): sort
    // only ever calls one orientation, so a rule that holds one way round
    // and breaks the other would slip through unnoticed.
    const cmp = queueOrder(NOON);
    expect(cmp(walkIn, undue)).toBeLessThan(0);
    expect(cmp(undue, walkIn)).toBeGreaterThan(0);
    expect(order([walkIn, undue])).toEqual([1, 2]);
  });

  it("lets that same appointment take the front once it is due", () => {
    const rows = [
      makeEntry({ id: 1, createdAt: "2026-08-17T11:00:00.000Z" }),
      makeEntry({
        id: 2,
        priority: "emergency",
        scheduledFor: "2026-08-17T15:00:00.000Z",
      }),
    ];
    expect([...rows].sort(queueOrder(at("2026-08-17T15:00:00.000Z")))).toEqual([
      rows[1],
      rows[0],
    ]);
  });

  it("orders undue appointments among themselves by start time", () => {
    expect(
      order([
        makeEntry({ id: 1, scheduledFor: "2026-08-17T17:00:00.000Z" }),
        makeEntry({ id: 2, scheduledFor: "2026-08-17T14:00:00.000Z" }),
      ]),
    ).toEqual([2, 1]);
  });

  it("breaks an exact tie by id, so the order never wobbles", () => {
    // Two people signed in the same millisecond would otherwise sort
    // arbitrarily, and the board would reshuffle on every poll.
    const same = "2026-08-17T09:00:00.000Z";
    expect(
      order([
        makeEntry({ id: 3, createdAt: same }),
        makeEntry({ id: 1, createdAt: same }),
        makeEntry({ id: 2, createdAt: same }),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("is antisymmetric for every pair of entries", () => {
    // The contract Array.sort relies on. An inconsistent comparator still
    // produces *an* order, so this is the only thing that catches one.
    const rows = [
      makeEntry({ id: 1, priority: "urgent" }),
      makeEntry({ id: 2, scheduledFor: "2026-08-17T15:00:00.000Z" }),
      makeEntry({ id: 3, priority: "emergency" }),
      makeEntry({ id: 4 }),
      makeEntry({ id: 5, scheduledFor: "2026-08-17T09:00:00.000Z" }),
      makeEntry({
        id: 6,
        priority: "emergency",
        scheduledFor: "2026-08-17T18:00:00.000Z",
      }),
    ];
    const cmp = queueOrder(NOON);

    for (const a of rows) {
      expect(cmp(a, a)).toBe(0);
      for (const b of rows) {
        // Summed rather than negated: Object.is separates +0 from -0, so
        // `toBe(-Math.sign(...))` fails on the equal case for no real reason.
        expect(Math.sign(cmp(a, b)) + Math.sign(cmp(b, a))).toBe(0);
      }
    }
  });

  it("is transitive, so the order cannot cycle", () => {
    const rows = [
      makeEntry({ id: 1, priority: "urgent" }),
      makeEntry({ id: 2, scheduledFor: "2026-08-17T15:00:00.000Z" }),
      makeEntry({ id: 3, priority: "emergency" }),
      makeEntry({ id: 4 }),
    ];
    const cmp = queueOrder(NOON);

    for (const a of rows) {
      for (const b of rows) {
        for (const c of rows) {
          if (cmp(a, b) <= 0 && cmp(b, c) <= 0) {
            expect(cmp(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});
