import { describe, it, expect } from "vitest";
import {
  normalizeMerchant,
  displayMerchant,
  redactForAI,
  matchRules,
  matchMesada,
  matchHistory,
  classifyLocal,
  type Rule,
  type TxLite,
  type MesadaRule,
} from "./categorize";

const tx = (over: Partial<TxLite>): TxLite => ({
  description_raw: "COMPRA 1234 CONTINENTE LISBOA 05/01",
  counterparty: null,
  amount_cents: -4520,
  booking_date: "2026-01-05",
  ...over,
});

describe("normalizeMerchant", () => {
  it("strips prefixes, card numbers and dates", () => {
    expect(normalizeMerchant("COMPRA 1234 CONTINENTE LISBOA 05/01")).toBe(
      "continente lisboa",
    );
    expect(normalizeMerchant("PAG. SERVICO EDP ENERGIA 12:30")).toContain("edp energia");
    expect(normalizeMerchant("MB WAY JOANA")).toBe("joana");
  });

  it("is stable across noise so the same shop keys the same", () => {
    const a = normalizeMerchant("COMPRA 9988 CONTINENTE 02/02 14:10");
    const b = normalizeMerchant("COMPRA 1234 CONTINENTE 09/09");
    expect(a).toBe(b);
  });

  it("title-cases for display", () => {
    expect(displayMerchant("COMPRA 1234 CONTINENTE LISBOA")).toBe("Continente Lisboa");
  });

  it("strips continuous IBAN tokens (no spaces)", () => {
    const n = normalizeMerchant("TRF PT50000201231234567890154 JOANA SILVA");
    expect(n).not.toMatch(/pt50000201231234567890154/);
    expect(n).toContain("joana silva"); // name handled separately by redactForAI
  });

  it("strips the longest matching prefix first (no shadowing)", () => {
    expect(normalizeMerchant("COMPRA C/ CARTAO CONTINENTE")).toBe(
      normalizeMerchant("COMPRA CONTINENTE"),
    );
    expect(normalizeMerchant("COMPRA C/ CARTAO CONTINENTE")).toBe("continente");
  });
});

describe("redactForAI", () => {
  it("removes IBANs and the counterparty name before sending to the AI", () => {
    const out = redactForAI("Sepa Pt50000201231234567890154 Joana Silva", "JOANA SILVA");
    expect(out).not.toMatch(/pt50/);
    expect(out).not.toMatch(/joana/);
    expect(out).not.toMatch(/silva/);
    expect(out).toContain("sepa");
  });
  it("keeps a plain merchant intact", () => {
    expect(redactForAI("Continente Lisboa", null)).toBe("continente lisboa");
  });
});

describe("matchRules", () => {
  const rules: Rule[] = [
    { field: "merchant", match_type: "contains", pattern: "continente", category_id: "super", priority: 100 },
    { field: "merchant", match_type: "contains", pattern: "continente lisboa", category_id: "special", priority: 10 },
  ];
  it("respects priority (lower first)", () => {
    expect(matchRules(tx({}), rules)).toBe("special");
  });
  it("supports equals and regex", () => {
    expect(
      matchRules(tx({ counterparty: "EDP" }), [
        { field: "counterparty", match_type: "equals", pattern: "edp", category_id: "luz", priority: 1 },
      ]),
    ).toBe("luz");
    expect(
      matchRules(tx({}), [
        { field: "merchant", match_type: "regex", pattern: "contin\\w+", category_id: "rx", priority: 1 },
      ]),
    ).toBe("rx");
  });
  it("returns null when nothing matches", () => {
    expect(matchRules(tx({}), [])).toBeNull();
  });
});

describe("matchMesada", () => {
  const mesadas: MesadaRule[] = [{ category_id: "mesada-joao", mesada_cents: 30000, mesada_day: 5 }];
  it("matches a debit of the mesada value near the day", () => {
    expect(matchMesada(tx({ amount_cents: -30000, booking_date: "2026-01-06" }), mesadas)).toBe("mesada-joao");
  });
  it("ignores credits and wrong amounts", () => {
    expect(matchMesada(tx({ amount_cents: 30000, booking_date: "2026-01-05" }), mesadas)).toBeNull();
    expect(matchMesada(tx({ amount_cents: -29000, booking_date: "2026-01-05" }), mesadas)).toBeNull();
  });
  it("ignores days far from the configured day", () => {
    expect(matchMesada(tx({ amount_cents: -30000, booking_date: "2026-01-20" }), mesadas)).toBeNull();
  });
});

describe("classifyLocal order", () => {
  const ctx = {
    rules: [{ field: "merchant", match_type: "contains", pattern: "continente", category_id: "super", priority: 100 } as Rule],
    mesadas: [{ category_id: "mesada", mesada_cents: 30000, mesada_day: 5 }],
    history: new Map([["continente lisboa", "hist-cat"]]),
  };
  it("rules win over history", () => {
    expect(classifyLocal(tx({}), ctx)).toMatchObject({ category_id: "super", source: "rule", confidence: 1 });
  });
  it("mesada wins when no rule matches", () => {
    const t = tx({ description_raw: "TRF MESADA", amount_cents: -30000, booking_date: "2026-01-05" });
    expect(classifyLocal(t, ctx)).toMatchObject({ source: "mesada" });
  });
  it("history applies when no rule/mesada", () => {
    const t = tx({ description_raw: "COMPRA CONTINENTE LISBOA", amount_cents: -1000 });
    const ctx2 = { ...ctx, rules: [] };
    expect(classifyLocal(t, ctx2)).toMatchObject({ category_id: "hist-cat", source: "history" });
  });
  it("returns null when AI is needed", () => {
    expect(classifyLocal(tx({ description_raw: "LOJA DESCONHECIDA", amount_cents: -500 }), { ...ctx, rules: [], history: new Map() })).toBeNull();
  });
});

describe("matchHistory", () => {
  it("keys on the normalized merchant", () => {
    const h = new Map([["fnac", "lazer"]]);
    expect(matchHistory(tx({ description_raw: "COMPRA 55 FNAC 01/02" }), h)).toBe("lazer");
  });
});
