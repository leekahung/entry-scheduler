import type request from "supertest";
import { fakeSheet } from "../sheet/sheet.fixture.js";
import { createStore } from "../sheet/store.js";

export const PASSCODE = "test-passcode";

/** Presents the shared passcode, for a deployment without Google sign-in. */
export const asAdmin = (req: request.Test) =>
  req.set("x-admin-passcode", PASSCODE);

/** A store backed by an in-memory sheet, empty at the start of each test. */
export const emptyStore = () => createStore(fakeSheet().transport);
