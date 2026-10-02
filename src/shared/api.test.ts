import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEntry, updateStatus } from "./api";

/** The body a call sent, as the server would read it. */
function sent(): Record<string, unknown> {
  const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

const ok = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

const ENTRY = { id: 7, createdAt: "2026-09-10T12:00:00.000Z" };

describe("who a status change credits", () => {
  it("sends the name while someone is being helped", async () => {
    ok();
    await updateStatus("pass", ENTRY, "pending", "Kim");
    expect(sent()).toEqual({ status: "pending", helpedBy: "Kim" });
  });

  // Putting a row back in the queue is not doing the helping, so the name of
  // whoever clicked must not land on top of whoever actually did.
  it("sends no name when an entry goes back to the queue", async () => {
    ok();
    await updateStatus("pass", ENTRY, "new", "Kim");
    expect(sent()).toEqual({ status: "new" });
  });

  it("omits a blank name rather than wiping the one already there", async () => {
    ok();
    await updateStatus("pass", ENTRY, "resolved", "");
    expect(sent()).toEqual({ status: "resolved" });
  });
});

describe("acting on an entry", () => {
  // A number freed by erasing is given out again; the time tells them apart.
  it("names the entry by its sign-in time as well as its number", async () => {
    ok();
    await updateStatus("pass", ENTRY, "pending", "");
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toBe("/api/entries/7?createdAt=2026-09-10T12%3A00%3A00.000Z");
  });

  it("passes on what the server said went wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Too many attempts." }), {
            status: 429,
          }),
      ),
    );
    await expect(deleteEntry("pass", ENTRY)).rejects.toMatchObject({
      message: "Too many attempts.",
      status: 429,
    });
  });
});
