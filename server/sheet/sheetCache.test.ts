import { afterEach, describe, expect, it, vi } from "vitest";
import { createSheetCache } from "./sheetCache.js";

const TTL = 1000;

/** A tab whose reads can be held open, counting each one. */
function tab(initial: string) {
  let value = initial;
  let held: Promise<void> | null = null;
  let release = () => {};
  const counts = { read: 0, write: 0 };
  return {
    counts,
    current: () => value,
    hold() {
      held = new Promise((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
    async read() {
      counts.read += 1;
      const seen = value;
      if (held) {
        const waiting = held;
        held = null;
        await waiting;
      }
      return seen;
    },
    async write(next: string) {
      counts.write += 1;
      value = next;
    },
  };
}

const cacheOf = (t: ReturnType<typeof tab>) =>
  createSheetCache(t.read, t.write, TTL);

afterEach(() => {
  vi.useRealTimers();
});

describe("the sheet cache", () => {
  it("serves from cache while fresh, then reads again", async () => {
    vi.useFakeTimers();
    const t = tab("a");
    const cache = cacheOf(t);

    await cache.load();
    await cache.load();
    expect(t.counts.read).toBe(1);

    vi.advanceTimersByTime(TTL + 1);
    await cache.load();
    expect(t.counts.read).toBe(2);
  });

  it("shares one read among everyone who asks while it runs", async () => {
    const t = tab("a");
    const cache = cacheOf(t);

    t.hold();
    const asked = [cache.load(), cache.load(), cache.load()];
    t.release();
    expect(await Promise.all(asked)).toEqual(["a", "a", "a"]);
    expect(t.counts.read).toBe(1);
  });

  // Or a removed staff member, say, would get their access back until expiry.
  it("does not let a read from before a write overwrite what it saved", async () => {
    const t = tab("old");
    const cache = cacheOf(t);

    t.hold();
    const stale = cache.load();
    await cache.queued(async () => cache.save("new"));
    t.release();
    expect(await stale).toBe("old");

    expect(await cache.load()).toBe("new");
  });

  // A read begun during a slow write still holds the old copy; once the
  // cache expires, nobody may join it, or a removed member gets back in.
  it("never hands out a read that began before the last write", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    let value = "old";
    let holdRead = false;
    let releaseRead = () => {};
    let releaseWrite = () => {};
    const cache = createSheetCache(
      async () => {
        const seen = value;
        if (holdRead) {
          holdRead = false;
          await new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
        }
        return seen;
      },
      async (next: string) => {
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        value = next;
      },
      TTL,
    );

    await cache.load();
    const saving = cache.queued(() => cache.save("new"));
    await tick();
    // The write is slow enough for the cache to expire, and a poll reads.
    vi.setSystemTime(TTL + 1);
    holdRead = true;
    const during = cache.load();
    releaseWrite();
    await saving;

    vi.setSystemTime(2 * TTL + 2);
    const after = cache.load();
    releaseRead();
    expect(await during).toBe("old");
    expect(await after).toBe("new");
  });

  it("builds a change on a fresh read, never the cache", async () => {
    const t = tab("a");
    const cache = cacheOf(t);
    await cache.load();
    // Changed behind the cache's back, as a hand edit in the sheet would be.
    await t.write("edited");

    const seen = await cache.queued((value) => value);
    expect(seen).toBe("edited");
  });

  it("runs changes one at a time, each on the last one's result", async () => {
    const t = tab("");
    const cache = cacheOf(t);

    await Promise.all(
      ["a", "b", "c"].map((letter) =>
        cache.queued((value) => cache.save(value + letter)),
      ),
    );
    expect(t.current()).toBe("abc");
  });

  it("carries on after a change fails", async () => {
    const t = tab("a");
    const cache = cacheOf(t);

    await expect(
      cache.queued(() => Promise.reject(new Error("Google said no"))),
    ).rejects.toThrow("Google said no");
    await cache.queued((value) => cache.save(`${value}!`));
    expect(t.current()).toBe("a!");
  });

  it("hands a queued task nothing from the task before it", async () => {
    const cache = cacheOf(tab("a"));
    const received: unknown[] = [];

    await cache.queued(() => "previous result");
    await cache.enqueue(async (...args: unknown[]) => {
      received.push(...args);
    });
    expect(received).toEqual([]);
  });
});
