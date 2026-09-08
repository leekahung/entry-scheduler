import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffList } from "../shared/types";
import { ApiError } from "../shared/api";
import StaffAccess from "./StaffAccess";

vi.mock("../shared/api", async (importActual) => ({
  // The real module carries ApiError and the types; only the three requests
  // this panel makes are stubbed.
  ...(await importActual<typeof import("../shared/api")>()),
  fetchStaff: vi.fn(),
  addStaff: vi.fn(),
  removeStaff: vi.fn(),
}));
const api = await import("../shared/api");

const LIST: StaffList = {
  you: { email: "boss@clinic.org", role: "owner" },
  bootstrapOwners: ["boss@clinic.org"],
  redundantRows: [],
  members: [
    {
      email: "kim@clinic.org",
      role: "staff",
      addedBy: "boss@clinic.org",
      addedAt: "",
    },
  ],
};

const show = async (list: StaffList = LIST) => {
  vi.mocked(api.fetchStaff).mockResolvedValue(list);
  render(<StaffAccess passcode="pass" />);
  await screen.findByText("kim@clinic.org");
};

const typeAddress = (address: string) =>
  userEvent.type(screen.getByLabelText(/add a google address/i), address);
const clickAdd = () =>
  userEvent.click(screen.getByRole("button", { name: "Add" }));

beforeEach(() => vi.clearAllMocks());

describe("showing who has access", () => {
  it("lists members and the owners set on the server", async () => {
    await show();
    expect(screen.getByText("boss@clinic.org")).toBeDefined();
    expect(screen.getByText(/owner · set on the server/i)).toBeDefined();
  });

  it("says so when the list cannot be loaded", async () => {
    vi.mocked(api.fetchStaff).mockRejectedValue(new Error("offline"));
    render(<StaffAccess passcode="pass" />);
    expect(
      await screen.findByText(/could not load the staff list/i),
    ).toBeDefined();
  });

  // Removing yourself is the one mistake that takes away the ability to undo
  // itself, so the server refuses it and the button must not offer it.
  it("will not offer to remove the person signed in", async () => {
    await show({
      ...LIST,
      you: { email: "kim@clinic.org", role: "owner" },
    });
    const remove = screen.getByRole("button", { name: "Remove" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("adding someone", () => {
  it("refuses an address the server would reject, without asking it", async () => {
    await show();
    // The browser's own check accepts this; the server's does not.
    await typeAddress("sam@clinic");
    await clickAdd();

    expect(await screen.findByText(/not a valid email address/i)).toBeDefined();
    expect(api.addStaff).not.toHaveBeenCalled();
  });

  it("explains an add that would change nothing", async () => {
    await show();
    await typeAddress("kim@clinic.org");
    await clickAdd();

    expect(
      await screen.findByText(/already on the list as staff/i),
    ).toBeDefined();
    expect(api.addStaff).not.toHaveBeenCalled();
  });

  it("sends a good address and reloads the list", async () => {
    await show();
    vi.mocked(api.addStaff).mockResolvedValue({
      email: "new@clinic.org",
      role: "staff",
      addedBy: "boss@clinic.org",
      addedAt: "",
    });

    await typeAddress("new@clinic.org");
    await clickAdd();

    await waitFor(() =>
      expect(api.addStaff).toHaveBeenCalledWith(
        "pass",
        "new@clinic.org",
        "staff",
      ),
    );
    // Reloaded rather than patched in, so the panel shows what the sheet holds.
    await waitFor(() => expect(api.fetchStaff).toHaveBeenCalledTimes(2));
    expect(
      (screen.getByLabelText(/add a google address/i) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("surfaces the server's own message when the add is refused", async () => {
    await show();
    vi.mocked(api.addStaff).mockRejectedValue(
      new ApiError("That address is not allowed here.", 400),
    );

    await typeAddress("new@clinic.org");
    await clickAdd();
    expect(
      await screen.findByText(/that address is not allowed here/i),
    ).toBeDefined();
  });
});

describe("removing someone", () => {
  it("asks before taking access away", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(
      await screen.findByText(/loses access to the console/i),
    ).toBeDefined();
    // Nothing sent while the question is still on screen.
    expect(api.removeStaff).not.toHaveBeenCalled();
  });

  it("does nothing when the question is declined", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.removeStaff).not.toHaveBeenCalled();
  });

  it("removes and reloads once confirmed", async () => {
    await show();
    vi.mocked(api.removeStaff).mockResolvedValue(undefined);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove access" }),
    );

    await waitFor(() =>
      expect(api.removeStaff).toHaveBeenCalledWith("pass", "kim@clinic.org"),
    );
    await waitFor(() => expect(api.fetchStaff).toHaveBeenCalledTimes(2));
  });
});

// The add form is also how a role is taken away: adding an address already on
// the list rewrites its row. Answering like an ordinary add is no way to find
// out an owner has just been demoted.
describe("changing the role of someone already listed", () => {
  const withOwner: StaffList = {
    ...LIST,
    members: [
      {
        email: "kim@clinic.org",
        role: "owner",
        addedBy: "boss@clinic.org",
        addedAt: "",
      },
    ],
  };

  it("asks before demoting, naming both roles", async () => {
    await show(withOwner);
    await typeAddress("kim@clinic.org");
    await clickAdd();

    expect(api.addStaff).not.toHaveBeenCalled();
    const asked = screen.getByRole("dialog").textContent ?? "";
    expect(asked).toContain("kim@clinic.org");
    expect(asked).toContain("already on the list as an owner");
    expect(asked).toContain("changes them to staff");
  });

  it("goes through with it once confirmed", async () => {
    await show(withOwner);
    await typeAddress("kim@clinic.org");
    await clickAdd();
    await userEvent.click(
      screen.getByRole("button", { name: "Change access" }),
    );
    expect(api.addStaff).toHaveBeenCalledWith(
      "pass",
      "kim@clinic.org",
      "staff",
    );
  });

  it("changes nothing when the question is declined", async () => {
    await show(withOwner);
    await typeAddress("kim@clinic.org");
    await clickAdd();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.addStaff).not.toHaveBeenCalled();
  });

  // Remove already refuses to let anyone take their own access away; the add
  // form was the way round it.
  it("refuses an owner making themselves staff", async () => {
    await show({
      ...LIST,
      you: { email: "kim@clinic.org", role: "owner" },
      bootstrapOwners: [],
      members: [
        {
          email: "kim@clinic.org",
          role: "owner",
          addedBy: "boss@clinic.org",
          addedAt: "",
        },
      ],
    });
    await typeAddress("kim@clinic.org");
    await clickAdd();

    await screen.findByText("You cannot change your own access to staff.");
    // The form answers it outright, rather than asking a question first.
    const dialog = screen.queryByRole("dialog", {
      hidden: true,
    }) as HTMLDialogElement | null;
    expect(dialog?.open).toBeFalsy();
    expect(api.addStaff).not.toHaveBeenCalled();
  });

  it("still adds someone new without asking", async () => {
    await show();
    await typeAddress("new@clinic.org");
    await clickAdd();
    await waitFor(() =>
      expect(api.addStaff).toHaveBeenCalledWith(
        "pass",
        "new@clinic.org",
        "staff",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
