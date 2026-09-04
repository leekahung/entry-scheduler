import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom keeps one document for the whole file, so a component left mounted
// would still be found by the next test's queries.
afterEach(cleanup);

// Components read this on mount for the name the console is helping as, and
// jsdom's own implementation is shared across tests in a file.
afterEach(() => localStorage.clear());

// jsdom parses <dialog> but implements none of its behaviour, so the
// confirmation dialogs would throw the moment they opened. Enough of it to
// drive them: `open` reflects the state, and close() fires the event the
// dialogs treat as a cancel. The focus trap and Esc are the browser's own and
// are not modelled here.
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
