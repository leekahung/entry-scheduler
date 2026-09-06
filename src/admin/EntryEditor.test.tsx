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
const fieldValue = (label: RegExp) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;
const clickSave = () =>
  userEvent.click(screen.getByRole("button", { name: "Save changes" }));

describe("what the editor sends on save", () => {
  // The server refuses an empty update, so an untouched row must not offer a
  // Save that would come back as "Could not save those changes."
  it("does not offer Save until something is touched", async () => {
    render(<Editor entry={makeAdminEntry()} onSave={save()} />);
    const button = screen.getByRole("button", { name: "Save changes" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/phone/i), "5");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends only the field that changed", async () => {
    const onSave = save();
    render(<Editor entry={makeAdminEntry()} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(/phone/i), "5551234");
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ phone: "5551234" });
  });

  // The bug this file was written for: the helper was seeded into both the
  // draft and the comparison copy, so it compared equal to itself and the
  // name staff could see in the field was dropped from the request.
  it("sends the prefilled helper even though nobody typed in the field", async () => {
    const onSave = save();
    render(<Editor entry={makeAdminEntry()} helper="Kim" onSave={onSave} />);

    expect(fieldValue(/helped by/i)).toBe("Kim");
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ helpedBy: "Kim" });
  });

  it("leaves a name already recorded alone rather than overwriting it", async () => {
    render(
      <Editor
        entry={makeAdminEntry({ helpedBy: "Sam" })}
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
    render(<Editor entry={makeAdminEntry()} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(/^time \(hours/i), "1.5");
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ timeSpent: 1.5 });
  });

  // An emptied box must reach the server as 0, not as NaN or a dropped field.
  // `Number("")` is already 0, so the `|| 0` beside it is belt-and-braces for
  // a value no number input will hand over; this pins the outcome, not that.
  it("sends an emptied time box as 0", async () => {
    const onSave = save();
    render(<Editor entry={makeAdminEntry({ timeSpent: 2 })} onSave={onSave} />);
    await userEvent.clear(screen.getByLabelText(/^time \(hours/i));
    await clickSave();
    expect(onSave).toHaveBeenCalledWith({ timeSpent: 0 });
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
