import type { ErrorRequestHandler, RequestHandler } from "express";

/** The request as a handler sees it, for helpers that only read from it. */
export type Req = Parameters<RequestHandler>[0];

/**
 * Sends a rejected handler to the error middleware.
 * Express 4 ignores a returned promise, so without this a Sheets outage would
 * leave the request hanging instead of answering.
 */
export const wrap =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

// Express's default handler renders the stack as HTML, leaking server paths
// and returning markup to callers that asked for JSON.
export const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err?.status === "number" && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error(err);
  res
    .status(status)
    .json({ error: status === 500 ? "Something went wrong." : "Bad request." });
};
