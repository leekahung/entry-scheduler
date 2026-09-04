import { Router } from "express";
import { queueOrder } from "../entry.js";
import { wrap } from "../http.js";
import { publicView } from "../publicEntry.js";
import { checkNewEntry } from "../validate.js";
import type { RouteContext } from "./context.js";

/** Public: anyone can join the queue and see who is waiting. */
export function queueRoutes({
  store,
  joinLimiter,
  queueLimiter,
}: RouteContext): Router {
  const routes = Router();

  routes.post(
    "/entries",
    joinLimiter,
    wrap(async (req, res) => {
      const checked = checkNewEntry(req.body);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }

      const { name, note, intake } = checked.value;
      const entry = await store.add(name, note, intake);
      // The full name goes back only to the visitor who just typed it.
      res.status(201).json({ ...publicView(entry), name: entry.name });
    }),
  );

  routes.get(
    "/queue",
    queueLimiter,
    wrap(async (_req, res) => {
      const entries = await store.list();
      // One clock reading for the whole response, so ordering and the due flags
      // can never disagree about an appointment that comes due mid-request.
      const now = Date.now();
      res.json(
        // Copied first: this is the store's cached array, and sorting it in
        // place would reorder the rows a concurrent write is about to save.
        [...entries]
          .sort(queueOrder(now))
          .map((entry) => publicView(entry, now)),
      );
    }),
  );

  return routes;
}
