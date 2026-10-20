import { describe, it, expect } from "vitest";
import {
  toCents,
  signedCents,
  ebExternalId,
  normalizeTransaction,
  prepareBatch,
  pickBalance,
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
  it("prefers entry_reference, else a hash — never the unstable transaction_id", () => {
    expect(ebExternalId(mk({ entry_reference: "E1", transaction_id: "T1" }), "2026-01-05")).toBe("ref:E1");
    expect(ebExternalId(mk({ transaction_id: "T1" }), "2026-01-05")).toMatch(/^h:2026-01-05:-4520:/);
    expect(ebExternalId(mk({ transaction_id: "T2" }), "2026-01-05")).toBe(
      ebExternalId(mk({ transaction_id: "T1" }), "2026-01-05"),
    );
  });

  it("entry_reference keeps the id stable across pending → booked", () => {
    const pending = mk({ entry_reference: "E9", status: "PDNG", booking_date: null, value_date: "2026-01-04" });
    const booked = mk({ entry_reference: "E9", status: "BOOK", booking_date: "2026-01-05" });
    expect(ebExternalId(pending, "2026-01-04")).toBe(ebExternalId(booked, "2026-01-05"));
  });
});

describe("normalizeTransaction", () => {
  it("maps a booked debit", () => {
    const n = normalizeTransaction(mk({ entry_reference: "E1" }), "2026-01-10");
    expect(n).toMatchObject({
      external_id: "ref:E1",
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

describe("statuses", () => {
  it("treats holds and scheduled movements as provisional, OTHR as booked", () => {
    expect(normalizeTransaction(mk({ status: "HOLD" }), "2026-01-10").status).toBe("provisorio");
    expect(normalizeTransaction(mk({ status: "SCHD" }), "2026-01-10").status).toBe("provisorio");
    expect(normalizeTransaction(mk({ status: "OTHR" }), "2026-01-10").status).toBe("confirmado");
  });
  it("falls back to transaction_date before today", () => {
    const n = normalizeTransaction(
      mk({ booking_date: null, value_date: null, transaction_date: "2026-01-03" }),
      "2026-01-10",
    );
    expect(n.booking_date).toBe("2026-01-03");
  });
  it("ignores a minus sign on the amount (the indicator gives the direction)", () => {
    expect(normalizeTransaction(mk({ transaction_amount: { amount: "-45.20" } }), "2026-01-10").amount_cents)
      .toBe(-4520);
  });
});

describe("prepareBatch", () => {
  it("keeps two identical same-day movements as two rows", () => {
    const { rows } = prepareBatch([mk({}), mk({})], "2026-01-10");
    expect(rows).toHaveLength(2);
    expect(rows[1].external_id).toBe(`${rows[0].external_id}#1`);
  });
  it("collapses a repeated entry_reference, booked wins over pending", () => {
    const { rows } = prepareBatch(
      [mk({ entry_reference: "E1", status: "BOOK" }), mk({ entry_reference: "E1", status: "PDNG" })],
      "2026-01-10",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmado");
  });
  it("drops cancelled/rejected movements and reports their ids", () => {
    const { rows, cancelledIds } = prepareBatch(
      [mk({ entry_reference: "E1", status: "CNCL" }), mk({ entry_reference: "E2", status: "RJCT" }), mk({})],
      "2026-01-10",
    );
    expect(rows).toHaveLength(1);
    expect(cancelledIds).toEqual(["ref:E1", "ref:E2"]);
  });
});

describe("pickBalance", () => {
  const b = (type: string, amount: string) => ({ balance_type: type, balance_amount: { amount } });
  it("prefers booked over available (which may include an overdraft)", () => {
    expect(pickBalance([b("ITAV", "1500.00"), b("CLBD", "1000.00")])?.balance_amount.amount).toBe("1000.00");
    expect(pickBalance([b("CLBD", "1000.00"), b("ITBD", "990.00")])?.balance_type).toBe("ITBD");
  });
  it("falls back to the first balance, or null", () => {
    expect(pickBalance([b("VALU", "5.00")])?.balance_type).toBe("VALU");
    expect(pickBalance([])).toBeNull();
    expect(pickBalance(undefined)).toBeNull();
  });
});
