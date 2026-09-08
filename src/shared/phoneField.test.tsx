import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PhoneField } from "./fields";

function Field({ start = "" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return <PhoneField id="p" value={value} onChange={setValue} />;
}

const box = () => screen.getByLabelText(/phone/i) as HTMLInputElement;

describe("PhoneField typing", () => {
  it("formats while the number is typed", async () => {
    render(<Field />);
    await userEvent.type(box(), "5035550142");
    expect(box().value).toBe("503-555-0142");
  });

  it("lets a typed dash through without doubling it", async () => {
    render(<Field />);
    await userEvent.type(box(), "503-555-0142");
    expect(box().value).toBe("503-555-0142");
  });

  it("backspaces a digit at a time rather than sticking on a dash", async () => {
    render(<Field start="503-555-0142" />);
    await userEvent.type(box(), "{backspace}{backspace}");
    expect(box().value).toBe("503-555-01");
  });

  it("stops formatting rather than inventing a number past ten digits", async () => {
    render(<Field />);
    await userEvent.type(box(), "50355501429999");
    // Every digit typed is still there — dropping the extras silently would
    // store a different number from the one on screen.
    expect(box().value.replace(/\D/g, "")).toBe("50355501429999");
  });
});
