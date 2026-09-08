import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SignInMode } from "../hooks/useAdminSession";
import AdminBanners from "./AdminBanners";

const ALERTS = {
  failedAttempts: 4,
  lastAttemptAt: null,
  windowMinutes: 15,
};

const show = (mode: SignInMode) =>
  render(
    <AdminBanners
      offline={false}
      rejected={null}
      onResume={vi.fn()}
      monthToClose=""
      alerts={ALERTS}
      mode={mode}
    />,
  );

describe("the failed sign-in alert", () => {
  it("sends a passcode deployment to the passcode", () => {
    show("passcode");
    expect(screen.getByRole("status").textContent).toContain(
      "rotate the passcode",
    );
  });

  // Google sign-in has no passcode to rotate, so naming one would send an
  // owner looking for a control this deployment does not have.
  it("sends a Google deployment to the staff list instead", () => {
    show("google");
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toContain("review who has access");
    expect(said).not.toContain("passcode");
  });

  it("stays quiet until the attempts are worth looking up", () => {
    render(
      <AdminBanners
        offline={false}
        rejected={null}
        onResume={vi.fn()}
        monthToClose=""
        alerts={{ ...ALERTS, failedAttempts: 2 }}
        mode="google"
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
