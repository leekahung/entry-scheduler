import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom keeps one document for the whole file, so a component left mounted
// would still be found by the next test's queries.
afterEach(cleanup);

// jsdom keeps these across a file's tests; left behind, the next test starts
// signed in.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// jsdom parses <dialog> but implements none of it: enough for the dialogs to
// open and cancel. Focus trap and Esc are not modelled.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
