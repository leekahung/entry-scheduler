import { describe, expect, it } from "vitest";
import { formatUsPhone, isCompleteUsPhone, usPhoneDigits } from "./phone";

describe("formatUsPhone", () => {
  it("adds the dashes as the number is typed", () => {
    expect(formatUsPhone("5")).toBe("5");
    expect(formatUsPhone("503")).toBe("503");
    expect(formatUsPhone("5035")).toBe("503-5");
    expect(formatUsPhone("503555")).toBe("503-555");
    expect(formatUsPhone("5035550142")).toBe("503-555-0142");
  });

  it("reformats a number however it was written", () => {
    for (const written of [
      "(503) 555-0142",
      "503.555.0142",
      "503 555 0142",
      "1-503-555-0142",
      "+1 (503) 555-0142",
    ]) {
      expect(formatUsPhone(written), written).toBe("503-555-0142");
    }
  });

  it("leaves alone what cannot be a US number", () => {
    // Rewriting these produced a different number that still looked real —
    // the worst outcome for a field somebody dials.
    expect(formatUsPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatUsPhone("503-555-0142 x27")).toBe("503-555-0142 x27");
    expect(formatUsPhone("50355501429999")).toBe("50355501429999");
  });

  it("is stable once formatted, so retyping cannot drift", () => {
    expect(formatUsPhone(formatUsPhone("5035550142"))).toBe("503-555-0142");
  });

  it("has nothing to say about an empty box", () => {
    expect(formatUsPhone("")).toBe("");
  });
});

describe("isCompleteUsPhone", () => {
  it("wants all ten digits", () => {
    expect(isCompleteUsPhone("503-555-014")).toBe(false);
    expect(isCompleteUsPhone("503-555-0142")).toBe(true);
    expect(isCompleteUsPhone("1-503-555-0142")).toBe(true);
    expect(isCompleteUsPhone("")).toBe(false);
  });
});

describe("usPhoneDigits", () => {
  it("strips the country code only when it leaves a whole number", () => {
    expect(usPhoneDigits("15035550142")).toBe("5035550142");
    expect(usPhoneDigits("1503555014")).toBe("1503555014");
  });
});
