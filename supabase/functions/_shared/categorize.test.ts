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
  mesadaRules,
  suggestRuleKeyword,
  matchesKeyword,
  isUsableKeyword,
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

describe("suggestRuleKeyword", () => {
  it("drops reference codes and noise words", () => {
    expect(suggestRuleKeyword("Estrang Www Amazon Nk8yt9dq4")).toBe("amazon");
    expect(suggestRuleKeyword("UBER *EATS PORTUGAL")).toBe("uber eats");
    expect(suggestRuleKeyword("COMPRA 4521 WWW.AMAZON.ES MKTP 12/10")).toBe("amazon");
    expect(suggestRuleKeyword("Continente Bom Dia Lisboa")).toBe("continente bom dia");
  });
  it("is empty when nothing usable is left", () => {
    expect(suggestRuleKeyword("WWW 123456")).toBe("");
    expect(suggestRuleKeyword("MB WAY P/ 912345678")).toBe("");
    expect(suggestRuleKeyword(null)).toBe("");
  });
  it("only joins consecutive words, so it always matches its own movement", () => {
    const samples = [
      "Compra Aliexpress.com Dublin Ie",
      "Estrang Www Shein Com Dublin Ie",
      "NETFLIX.COM AMSTERDAM",
      "SPOTIFY P1A2B3C4D5 STOCKHOLM",
      "Estrang Www Amazon Nk8yt9dq4 Lu",
      "COMPRA 4521 ZARA LISBOA 12/10",
      "UBER *EATS PORTUGAL",
      "Estrang Www Amazon Nk8yt9dq4",
    ];
    for (const d of samples) {
      const k = suggestRuleKeyword(d);
      expect(k, d).not.toBe("");
      expect(matchesKeyword(d, k), `${d} → ${k}`).toBe(true);
    }
    expect(suggestRuleKeyword("NETFLIX.COM AMSTERDAM")).toBe("netflix");
  });
});

describe("isUsableKeyword", () => {
  it("rejects keywords too short or made of noise", () => {
    expect(isUsableKeyword("p")).toBe(false);
    expect(isUsableKeyword("e ")).toBe(false);
    expect(isUsableKeyword("www")).toBe(false);
    expect(isUsableKeyword("amazon")).toBe(true);
    expect(isUsableKeyword("uber eats")).toBe(true);
  });
});

describe("matchesKeyword", () => {
  it("matches every purchase of a merchant regardless of the code", () => {
    expect(matchesKeyword("Estrang Www Amazon Nk8yt9dq4", "amazon")).toBe(true);
    expect(matchesKeyword("Estrang Www Amazon Zz91kk2", "Amazon")).toBe(true);
    expect(matchesKeyword("UBER   *EATS help.uber.com", "uber eats")).toBe(true);
    expect(matchesKeyword("UBER *TRIP", "uber eats")).toBe(false);
  });
  it("never matches an empty keyword", () => {
    expect(matchesKeyword("anything", "  ")).toBe(false);
  });
});

describe("mesadaRules", () => {
  const members = [
    { display_name: "João", mesada_cents: 30000, mesada_day: 5 },
    { display_name: "Joana", mesada_cents: 30000, mesada_day: null },
    { display_name: "Sem mesada", mesada_cents: 0, mesada_day: null },
  ];
  it("maps each member to the app's own mesada category, first in order", () => {
    const cats = [
      { id: "extra", name: "Mesada João extra", grp: "mesada", sort: 5, system_role: null },
      { id: "joao", name: "Mesada João", grp: "mesada", sort: 510, system_role: "mesada" },
      { id: "joana", name: "Mesada Joana", grp: "mesada", sort: 520, system_role: "mesada" },
      { id: "fake", name: "Mesada Joana", grp: "variavel", sort: 1, system_role: null },
    ];
    expect(mesadaRules(cats, members)).toEqual([
      { category_id: "joao", mesada_cents: 30000, mesada_day: 5 },
      { category_id: "joana", mesada_cents: 30000, mesada_day: null },
    ]);
  });
  it("works without roles (by group and name)", () => {
    const cats = [
      { id: "joana", name: "Mesada Joana", grp: "mesada", sort: 520 },
      { id: "joao", name: "Mesada João", grp: "mesada", sort: 510 },
    ];
    expect(mesadaRules(cats, members).map((m) => m.category_id)).toEqual(["joao", "joana"]);
  });
});
