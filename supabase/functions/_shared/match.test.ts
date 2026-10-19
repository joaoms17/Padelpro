import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  merchantSimilarity,
  isMatch,
  reconcile,
  parseAppleAmount,
  daysWaiting,
  type ApplePayTx,
  type BankTx,
} from "./match";

describe("merchantSimilarity", () => {
  it("matches the same merchant despite accents/case/noise", () => {
    expect(merchantSimilarity("Continente Lisboa", "COMPRA CONTINENTE")).toBeGreaterThan(0.4);
  });
  it("single-token containment falls back to 0.5", () => {
    expect(merchantSimilarity("Fnac", "fnac online")).toBeGreaterThanOrEqual(0.5);
  });
  it("different merchants score low", () => {
    expect(merchantSimilarity("Galp", "Continente")).toBe(0);
  });
});

const ap = (over: Partial<ApplePayTx>): ApplePayTx => ({
  id: "ap1",
  amount_cents: -4520,
  merchant: "Continente",
  occurred_at: "2026-01-05",
  ...over,
});
const bank = (over: Partial<BankTx>): BankTx => ({
  id: "b1",
  amount_cents: -4520,
  description_raw: "COMPRA CONTINENTE LISBOA",
  merchant_clean: "Continente Lisboa",
  booking_date: "2026-01-06",
  ...over,
});

describe("isMatch", () => {
  it("matches same amount, within date window, similar merchant", () => {
    expect(isMatch(ap({}), bank({}))).toBe(true);
  });
  it("rejects different amounts", () => {
    expect(isMatch(ap({ amount_cents: -4521 }), bank({}))).toBe(false);
  });
  it("rejects dates outside −1..+3 days", () => {
    expect(isMatch(ap({}), bank({ booking_date: "2026-01-10" }))).toBe(false);
    expect(isMatch(ap({}), bank({ booking_date: "2026-01-03" }))).toBe(false);
  });
  it("rejects dissimilar merchants", () => {
    expect(isMatch(ap({ merchant: "Galp" }), bank({}))).toBe(false);
  });
});

describe("reconcile", () => {
  it("pairs each provisional with one bank movement, no double use", () => {
    const provisionals = [
      ap({ id: "ap1", merchant: "Continente", amount_cents: -4520, occurred_at: "2026-01-05" }),
      ap({ id: "ap2", merchant: "Galp", amount_cents: -6000, occurred_at: "2026-01-05" }),
    ];
    const banks = [
      bank({ id: "b1", merchant_clean: "Continente Lisboa", amount_cents: -4520, booking_date: "2026-01-06" }),
      bank({ id: "b2", merchant_clean: "Galp Combustiveis", description_raw: "GALP", amount_cents: -6000, booking_date: "2026-01-06" }),
    ];
    const pairs = reconcile(provisionals, banks);
    expect(pairs).toHaveLength(2);
    expect(pairs.find((p) => p.applePayId === "ap1")?.bankId).toBe("b1");
    expect(pairs.find((p) => p.applePayId === "ap2")?.bankId).toBe("b2");
  });

  it("leaves a provisional unpaired when no bank movement matches", () => {
    const pairs = reconcile([ap({})], [bank({ amount_cents: -9999 })]);
    expect(pairs).toHaveLength(0);
  });

  it("does not reuse the same bank row for two provisionals", () => {
    const provisionals = [ap({ id: "ap1" }), ap({ id: "ap2" })];
    const pairs = reconcile(provisionals, [bank({ id: "b1" })]);
    expect(pairs).toHaveLength(1);
  });
});

describe("parseAppleAmount", () => {
  it("parses euro text to positive cents", () => {
    expect(parseAppleAmount("12,34 €")).toBe(1234);
    expect(parseAppleAmount("1 234,56 €")).toBe(123456);
    expect(parseAppleAmount("45.20")).toBe(4520);
    expect(parseAppleAmount("abc")).toBeNull();
  });
});

describe("daysWaiting", () => {
  it("counts days since the purchase", () => {
    expect(daysWaiting("2026-01-01", "2026-01-09")).toBe(8);
  });
});
