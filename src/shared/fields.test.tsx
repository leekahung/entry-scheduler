import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GENDERS } from "../../server/shared/codes";
import { CodeSelect } from "./fields";

const select = () => screen.getByLabelText("Gender") as HTMLSelectElement;

describe("a select over a controlled vocabulary", () => {
  // These fields are filled in over the course of a visit, so the box has to
  // be able to say "not asked yet".
  it("opens on blank rather than the first code", () => {
    render(
      <CodeSelect
        id="gender"
        label="Gender"
        value=""
        codes={GENDERS}
        onChange={() => {}}
      />,
    );

    expect(select().value).toBe("");
    expect((screen.getAllByRole("option")[0] as HTMLOptionElement).value).toBe(
      "",
    );
  });

  it("offers blank alongside the codes, so an answer can be taken back", () => {
    render(
      <CodeSelect
        id="gender"
        label="Gender"
        value="Female"
        codes={GENDERS}
        onChange={() => {}}
      />,
    );

    expect(select().value).toBe("Female");
    expect(screen.getAllByRole("option")).toHaveLength(GENDERS.length + 1);
  });

  it("reports the code that was chosen", async () => {
    const onChange = vi.fn();
    render(
      <CodeSelect
        id="gender"
        label="Gender"
        value=""
        codes={GENDERS}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(select(), "Non-binary");

    expect(onChange).toHaveBeenCalledWith("Non-binary");
  });
});
