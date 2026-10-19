import { describe, it, expect } from "vitest";
import { parseCents, formatSigned, formatCents } from "./format";

describe("parseCents", () => {
  it("parses euro text with comma decimals", () => {
    expect(parseCents("12,34 €")).toBe(1234);
    expect(parseCents("12,34")).toBe(1234);
  });

  it("parses thousands separators", () => {
    expect(parseCents("1 234,56 €")).toBe(123456);
    expect(parseCents("1.234,56")).toBe(123456);
  });

  it("parses plain dot decimals", () => {
    expect(parseCents("12.34")).toBe(1234);
  });

  it("handles negatives and whitespace", () => {
    expect(parseCents("-5,00")).toBe(-500);
    expect(parseCents("  7,5 ")).toBe(750);
  });

  it("returns null for junk", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats cents as euros", () => {
    // non-breaking spaces in pt-PT output; assert the digits/symbol loosely
    expect(formatCents(123456)).toMatch(/1.?234,56.*€/);
  });

  it("adds an explicit sign", () => {
    expect(formatSigned(1234)).toMatch(/^\+.*12,34.*€$/);
    expect(formatSigned(-1234)).toMatch(/^−.*12,34.*€$/);
    expect(formatSigned(0)).toMatch(/0,00.*€$/);
  });
});
