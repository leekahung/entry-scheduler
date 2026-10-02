import { createServer, type RequestListener } from "node:http";
import type request from "supertest";
import { afterAll, beforeAll } from "vitest";
import { fakeSheet } from "../sheet/sheet.fixture.js";
import { createStore } from "../sheet/store.js";

export const PASSCODE = "test-passcode";

/** Presents the shared passcode, for a deployment without Google sign-in. */
export const asAdmin = (req: request.Test) =>
  req.set("x-admin-passcode", PASSCODE);

/** A store backed by an in-memory sheet, empty at the start of each test. */
export const emptyStore = () => createStore(fakeSheet().transport);

/**
 * One listener for the file, delegating to whichever app the current test
 * built: a port per request or per test churned until replies went astray.
 */
export function testServer(current: () => RequestListener) {
  const server = createServer((req, res) => current()(req, res));
  beforeAll(() => new Promise<void>((ready) => server.listen(0, ready)));
  afterAll(() => new Promise<void>((done) => server.close(() => done())));
  return server;
}
