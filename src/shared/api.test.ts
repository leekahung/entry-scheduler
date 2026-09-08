import { afterEach, describe, expect, it, vi } from "vitest";
import { updateStatus } from "./api";

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

describe("who a status change credits", () => {
  it("sends the name while someone is being helped", async () => {
    ok();
    await updateStatus("pass", 7, "pending", "Kim");
    expect(sent()).toEqual({ status: "pending", helpedBy: "Kim" });
  });

  // Putting a row back in the queue is not doing the helping, so the name of
  // whoever clicked must not land on top of whoever actually did.
  it("sends no name when an entry goes back to the queue", async () => {
    ok();
    await updateStatus("pass", 7, "new", "Kim");
    expect(sent()).toEqual({ status: "new" });
  });

  it("omits a blank name rather than wiping the one already there", async () => {
    ok();
    await updateStatus("pass", 7, "resolved", "");
    expect(sent()).toEqual({ status: "resolved" });
  });
});
