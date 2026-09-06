import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// Stands in for the chunk a tablet asks for after a deploy has replaced it:
// the file is gone, so the dynamic import rejects.
vi.mock("./pages/AdminPage", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("a console that cannot be fetched", () => {
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("offers a reload rather than leaving a blank page", async () => {
    // React reports the error it is about to hand the boundary; the test is
    // about what the boundary does with it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.location.hash = "#/admin";

    render(<App />);

    await screen.findByRole("heading", {
      name: /console could not be loaded/i,
    });
    expect(screen.getByRole("button", { name: "Reload" })).not.toBeNull();
  });
});
