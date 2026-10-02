/**
 * A whole tab held in memory: reads come from cache while fresh, and changes
 * run one at a time. Shared by the queue and the staff list, so their race
 * guards cannot drift apart.
 */
export function createSheetCache<T>(
  read: () => Promise<T>,
  write: (value: T) => Promise<void>,
  ttl: number,
) {
  let cache: T | null = null;
  let cachedAt = 0;
  // The read on its way to Google, shared by everyone who asks while it runs.
  let reading: Promise<T> | null = null;
  // Bumped by every write, so a read already in flight cannot cache the copy
  // from before it.
  let generation = 0;
  // A whole-tab read-modify-write has no transaction, so changes are queued.
  let queue: Promise<unknown> = Promise.resolve();

  /** The tab, from cache while fresh; callers during a read share it. */
  function load(): Promise<T> {
    if (cache !== null && Date.now() - cachedAt < ttl) {
      return Promise.resolve(cache);
    }
    if (reading) return reading;

    const at = generation;
    const run = (async () => {
      const value = await read();
      if (at === generation) {
        cache = value;
        cachedAt = Date.now();
      }
      return value;
    })();
    reading = run;
    const finished = () => {
      if (reading === run) reading = null;
    };
    run.then(finished, finished);
    return run;
  }

  async function save(value: T): Promise<void> {
    await write(value);
    generation += 1;
    // A read still running began before this write, so nobody may join it.
    reading = null;
    cache = value;
    cachedAt = Date.now();
  }

  /** Runs `task` after everything queued; a failure does not jam the queue. */
  function enqueue<R>(task: () => Promise<R>): Promise<R> {
    // Called bare, so `task` never receives the previous task's result.
    const run = queue.then(() => task());
    queue = run.catch(() => {});
    return run;
  }

  /** A read-modify-write on a fresh read, never the cache or an older read. */
  function queued<R>(work: (value: T) => Promise<R> | R): Promise<R> {
    return enqueue(async () => {
      generation += 1;
      cache = null;
      reading = null;
      return work(await load());
    });
  }

  return { load, save, enqueue, queued };
}
