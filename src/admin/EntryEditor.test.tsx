import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AdminEntry } from "../shared/types";
import { makeAdminEntry } from "../shared/entry.fixture";
import type { EntryChanges } from "../hooks/useEntries";
import { seedDraft } from "./editorDraft";
import EntryEditor from "./EntryEditor";

/**
 * The editor is controlled, so this stands in for the page that owns its
 * draft. `helper` is seeded into the draft but never into `initial`, which is
 * exactly how AdminPage wires it: a prefilled name has to read as a change.
 */
function Editor({
  entry,
  helper = "",
  onSave,
  onCancel = () => {},
}: {
  entry: AdminEntry;
  helper?: string;
  onSave: (details: EntryChanges) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(() => seedDraft(entry, helper));
  const [initial] = useState(() => seedDraft(entry));
  return (
    <EntryEditor
      entry={entry}
      draft={draft}
      initial={initial}
      onChange={setDraft}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

const save = () => vi.fn(async () => true);
// The log needs both on every row, and the editor refuses to save without
// them, so a row under test starts with them unless it is testing that.
const filledIn = (overrides: Partial<AdminEntry> = {}) =>
  makeAdminEntry({ dob: "1990-04-01", phone: "5035550142", ...overrides });
const fieldValue = (label: RegExp) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;
const clickSave = () =>
  userEvent.click(screen.getByRole("button", { name: "Save changes" }));

describe("what the editor sends on save", () => {
  // The server refuses an empty update, so an untouched row must not offer a
  // Save that would come back as "Could not save those changes."
  it("does not offer Save until something is touched", async () => {
    render(<Editor entry={filledIn()} onSave={save()} />);
    const button = screen.getByRole("button", { name: "Save changes" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/helped by/i), "Kim");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends only the field that changed", async () => {
    const onSave = save();
    render(<Editor entry={filledIn()} onSave={onSave} />);
    await userEvent.clear(screen.getByLabelText(/phone/i));
    await userEvent.type(screen.getByLabelText(/phone/i), "5035551234");
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ phone: "503-555-1234" });
  });

  // The bug this file was written for: the helper was seeded into both the
  // draft and the comparison copy, so it compared equal to itself and the
  // name staff could see in the field was dropped from the request.
  it("sends the prefilled helper even though nobody typed in the field", async () => {
    const onSave = save();
    render(<Editor entry={filledIn()} helper="Kim" onSave={onSave} />);

    expect(fieldValue(/helped by/i)).toBe("Kim");
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ helpedBy: "Kim" });
  });

  it("leaves a name already recorded alone rather than overwriting it", async () => {
    render(
      <Editor
        entry={filledIn({ helpedBy: "Sam" })}
        helper="Kim"
        onSave={save()}
      />,
    );

    expect(fieldValue(/helped by/i)).toBe("Sam");
    // Nothing changed, so there is nothing to send — and no Save to send it.
    expect(
      (
        screen.getByRole("button", {
          name: "Save changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("sends a quarter-hour time as a number", async () => {
    const onSave = save();
    render(<Editor entry={filledIn()} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(/^time \(hours/i), "1.5");
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ timeSpent: 1.5 });
  });

  it("will not save a row still missing a date of birth or phone", async () => {
    const onSave = save();
    render(
      <Editor entry={makeAdminEntry({ dob: "", phone: "" })} onSave={onSave} />,
    );

    await userEvent.type(screen.getByLabelText(/helped by/i), "Kim");
    await clickSave();
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/date of birth/i), "1990-04-01");
    await clickSave();
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/phone/i), "5035550142");
    await clickSave();
    expect(onSave).toHaveBeenCalled();
  });

  it("will not save half a phone number", async () => {
    const onSave = save();
    render(<Editor entry={filledIn()} onSave={onSave} />);

    await userEvent.clear(screen.getByLabelText(/phone/i));
    await userEvent.type(screen.getByLabelText(/phone/i), "50355");
    await clickSave();
    expect(onSave).not.toHaveBeenCalled();
  });

  // An emptied box must reach the server as 0, not as NaN or a dropped field.
  // `Number("")` is already 0, so the `|| 0` beside it is belt-and-braces for
  // a value no number input will hand over; this pins the outcome, not that.
  it("sends an emptied time box as 0", async () => {
    const onSave = save();
    render(<Editor entry={filledIn({ timeSpent: 2 })} onSave={onSave} />);
    await userEvent.clear(screen.getByLabelText(/^time \(hours/i));
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ timeSpent: 0 });
  });
});

describe("which fields have to be filled in", () => {
  const className = (label: RegExp) => screen.getByLabelText(label).className;

  it("tints the two required fields apart from the optional ones", () => {
    render(<Editor entry={makeAdminEntry()} onSave={save()} />);

    for (const label of [/date of birth/i, /phone/i]) {
      expect(className(label)).toContain("bg-alert-surface");
      expect(screen.getByLabelText(label).hasAttribute("required")).toBe(true);
    }
    for (const label of [
      /gender/i,
      /case type/i,
      /helped by/i,
      /appointment time/i,
      /appointment type/i,
      /appointment outcome/i,
      /legal outcome/i,
      /^time \(hours/i,
    ]) {
      expect(className(label), String(label)).toContain("bg-caution-surface");
    }
  });

  // The note is the one field left in the page's own voice.
  it("leaves the admin note untinted", () => {
    render(<Editor entry={makeAdminEntry()} onSave={save()} />);
    expect(className(/admin note/i)).not.toContain("bg-caution-surface");
    expect(className(/admin note/i)).not.toContain("bg-alert-surface");
  });

  it("drops a tint once its field is filled in", async () => {
    render(<Editor entry={makeAdminEntry()} onSave={save()} />);
    expect(className(/phone/i)).toContain("bg-alert-surface");

    await userEvent.type(screen.getByLabelText(/phone/i), "5035550142");
    expect(className(/phone/i)).not.toContain("bg-alert-surface");
  });

  it("reminds staff to record the time until they have", async () => {
    render(<Editor entry={filledIn()} onSave={save()} />);
    expect(screen.getByText(/still to record/i)).toBeTruthy();

    await userEvent.clear(screen.getByLabelText(/^time \(hours/i));
    await userEvent.type(screen.getByLabelText(/^time \(hours/i), "1.5");
    expect(screen.queryByText(/still to record/i)).toBeNull();
  });

  it("keeps the tint on a half-typed phone number", async () => {
    render(<Editor entry={makeAdminEntry()} onSave={save()} />);
    await userEvent.type(screen.getByLabelText(/phone/i), "50355");
    expect(className(/phone/i)).toContain("bg-alert-surface");
  });
});

describe("closing an editor with edits in it", () => {
  const clickCancel = () =>
    userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // A closed <dialog> still renders its markup, so `open` is the only honest
  // way to ask whether the question is on screen.
  const asking = () =>
    (screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement).open;

  it("closes straight away when nothing has been touched", async () => {
    const onCancel = vi.fn();
    render(
      <Editor entry={makeAdminEntry()} onSave={save()} onCancel={onCancel} />,
    );
    await clickCancel();

    expect(onCancel).toHaveBeenCalled();
    expect(asking()).toBe(false);
  });

  // The draft is the only copy of what was typed.
  it("asks before throwing edits away", async () => {
    const onCancel = vi.fn();
    render(
      <Editor entry={makeAdminEntry()} onSave={save()} onCancel={onCancel} />,
    );
    await userEvent.type(screen.getByLabelText(/phone/i), "5035550142");
    await clickCancel();

    expect(asking()).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("stays open when the question is declined", async () => {
    const onCancel = vi.fn();
    render(
      <Editor entry={makeAdminEntry()} onSave={save()} onCancel={onCancel} />,
    );
    await userEvent.type(screen.getByLabelText(/phone/i), "5035550142");
    await clickCancel();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(asking()).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closes once the discard is confirmed", async () => {
    const onCancel = vi.fn();
    render(
      <Editor entry={makeAdminEntry()} onSave={save()} onCancel={onCancel} />,
    );
    await userEvent.type(screen.getByLabelText(/phone/i), "5035550142");
    await clickCancel();
    await userEvent.click(
      screen.getByRole("button", { name: "Discard changes" }),
    );

    expect(onCancel).toHaveBeenCalled();
  });
});
