import { describe, it, expect } from "vitest";
import {
  toCents,
  signedCents,
  ebExternalId,
  normalizeTransaction,
  type EBTransaction,
} from "./normalize";

const mk = (over: Partial<EBTransaction>): EBTransaction => ({
  transaction_amount: { amount: "45.20", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  booking_date: "2026-01-05",
  remittance_information: ["COMPRA CONTINENTE"],
  ...over,
});

describe("amounts", () => {
  it("parses to signed cents (DBIT negative, CRDT positive)", () => {
    expect(toCents("45.20")).toBe(4520);
    expect(signedCents(mk({}))).toBe(-4520);
    expect(
      signedCents(mk({ credit_debit_indicator: "CRDT", transaction_amount: { amount: "650.00" } })),
    ).toBe(65000);
  });
});

describe("ebExternalId precedence", () => {
  it("prefers entry_reference, then transaction_id, then a hash", () => {
    expect(ebExternalId(mk({ entry_reference: "E1", transaction_id: "T1" }), "2026-01-05")).toBe("ref:E1");
    expect(ebExternalId(mk({ transaction_id: "T1" }), "2026-01-05")).toBe("tid:T1");
    expect(ebExternalId(mk({}), "2026-01-05")).toMatch(/^h:2026-01-05:-4520:/);
  });

  it("entry_reference keeps the id stable across pending → booked", () => {
    const pending = mk({ entry_reference: "E9", status: "PDNG", booking_date: null, value_date: "2026-01-04" });
    const booked = mk({ entry_reference: "E9", status: "BOOK", booking_date: "2026-01-05" });
    expect(ebExternalId(pending, "2026-01-04")).toBe(ebExternalId(booked, "2026-01-05"));
  });
});

describe("normalizeTransaction", () => {
  it("maps a booked debit", () => {
    const n = normalizeTransaction(mk({ transaction_id: "T1" }), "2026-01-10");
    expect(n).toMatchObject({
      external_id: "tid:T1",
      booking_date: "2026-01-05",
      amount_cents: -4520,
      description_raw: "COMPRA CONTINENTE",
      status: "confirmado",
    });
  });

  it("flags pending as provisório and picks the counterparty by direction", () => {
    const credit = normalizeTransaction(
      mk({
        credit_debit_indicator: "CRDT",
        status: "PDNG",
        transaction_amount: { amount: "650.00" },
        debtor: { name: "INQUILINO" },
        remittance_information: "RENDA",
      }),
      "2026-01-10",
    );
    expect(credit.status).toBe("provisorio");
    expect(credit.amount_cents).toBe(65000);
    expect(credit.counterparty).toBe("INQUILINO");
  });
});
