import { describe, it, expect } from "vitest";
import { parseCents, formatSigned, formatCents, formatEuros } from "./format";

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

describe("formatCents (exact)", () => {
  it("groups thousands and keeps two decimals", () => {
    expect(formatCents(195157)).toBe("1\u00a0951,57\u00a0€");
    expect(formatCents(-4500)).toBe("-45,00\u00a0€");
    expect(formatSigned(764388)).toBe("+7\u00a0643,88\u00a0€");
    expect(formatCents(5)).toBe("0,05\u00a0€");
  });
});

describe("formatEuros", () => {
  it("rounds to the euro and always groups thousands", () => {
    expect(formatEuros(891000)).toBe("8 910 €");
    expect(formatEuros(1092700)).toBe("10 927 €");
    expect(formatEuros(-4550)).toBe("-46 €");
    expect(formatEuros(0)).toBe("0 €");
  });
});
