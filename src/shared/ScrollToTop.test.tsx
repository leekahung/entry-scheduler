import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScrollToTop from "./ScrollToTop";

const scrollTo = (y: number) => {
  window.scrollY = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
};

beforeEach(() => {
  window.scrollY = 0;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

const button = () => screen.queryByRole("button", { name: /top/i });

describe("ScrollToTop", () => {
  it("stays out of the way near the top of the page", () => {
    render(<ScrollToTop />);
    expect(button()).toBeNull();

    scrollTo(120);
    expect(button()).toBeNull();
  });

  it("appears once the page has scrolled a little way", () => {
    render(<ScrollToTop />);
    scrollTo(400);
    expect(button()).not.toBeNull();
  });

  // The threshold used to be one screenful, which a tall desktop window could
  // never scroll past, so the button never appeared there at all.
  it("appears on a tall window too, where a screenful is out of reach", () => {
    window.innerHeight = 1400;
    render(<ScrollToTop />);
    scrollTo(400);
    expect(button()).not.toBeNull();
  });

  it("goes away again on the way back up", () => {
    render(<ScrollToTop />);
    scrollTo(400);
    scrollTo(0);
    expect(button()).toBeNull();
  });

  it("scrolls rather than jumping when pressed", async () => {
    render(<ScrollToTop />);
    scrollTo(400);
    const el = button();
    if (!el) throw new Error("button should be shown");
    await userEvent.click(el);
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });
});
