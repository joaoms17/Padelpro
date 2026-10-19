import { describe, it, expect } from "vitest";
import {
  monthTotals,
  coberturaBaseFixa,
  comprometidoDia1,
  compromissosPorSair,
  almofadaDisponivel,
  almofadaMeses,
  almofadaLivre,
  previsaoFimMes,
  goalMonthlyNeeded,
  type MetricTx,
} from "./metrics";
import type { CategoryGroup } from "./types";

const group = new Map<string, CategoryGroup>([
  ["salario", "entrada"],
  ["renda", "entrada"],
  ["luz", "fixa"],
  ["super", "variavel"],
  ["material", "atividade"],
  ["mesadaJ", "mesada"],
  ["entreContas", "interna"],
]);

describe("monthTotals (manual-calc acceptance)", () => {
  const txs: MetricTx[] = [
    { category_id: "salario", amount_cents: 200000 }, // +2000 entrada
    { category_id: "renda", amount_cents: 65000 }, // +650 entrada
    { category_id: "luz", amount_cents: -6000 }, // −60 fixa
    { category_id: "super", amount_cents: -40000 }, // −400 variável
    { category_id: "material", amount_cents: -5000 }, // −50 atividade
    { category_id: "mesadaJ", amount_cents: -30000 }, // −300 mesada
    { category_id: "entreContas", amount_cents: -100000 }, // internal, ignored
    { category_id: null, amount_cents: -1000 }, // uncategorized, ignored
  ];
  it("computes entradas, despesas, mesadas, sobra, taxa", () => {
    const t = monthTotals(txs, group);
    expect(t.entradasCents).toBe(265000);
    expect(t.despesasCasaCents).toBe(51000); // 6000+40000+5000
    expect(t.mesadasCents).toBe(30000);
    expect(t.sobraCents).toBe(184000); // 265000−51000−30000
    expect(t.taxaPoupanca).toBeCloseTo(184000 / 265000);
  });
});

describe("base fixa coverage", () => {
  it("cobertura < 1 when base fixa does not cover fixed + mesadas", () => {
    expect(coberturaBaseFixa(100000, 60000, 60000)).toBeCloseTo(100000 / 120000);
    expect(coberturaBaseFixa(100000, 60000, 60000) < 1).toBe(true);
  });
  it("comprometido no dia 1", () => {
    expect(comprometidoDia1(60000, 60000, 240000)).toBeCloseTo(0.5);
  });
});

describe("almofada", () => {
  it("disponível = saldo − compromissos por sair", () => {
    const comp = compromissosPorSair({ fixasPorSairCents: 20000, mesadasPorSairCents: 30000, variaveisPorGastarCents: 10000 });
    expect(comp).toBe(60000);
    const disp = almofadaDisponivel(500000, comp);
    expect(disp).toBe(440000);
    expect(almofadaMeses(440000, 110000)).toBeCloseTo(4);
    expect(almofadaLivre(440000, 40000)).toBe(400000);
  });
  it("clamps negative commitment parts to zero", () => {
    expect(compromissosPorSair({ fixasPorSairCents: -5, mesadasPorSairCents: 0, variaveisPorGastarCents: -10 })).toBe(0);
  });
});

describe("previsaoFimMes", () => {
  it("projects variable spend to month end and subtracts the remainder", () => {
    const p = previsaoFimMes({
      balanceCents: 500000,
      entradasEsperadasCents: 100000,
      fixasPorSairCents: 20000,
      mesadasPorSairCents: 30000,
      variaveisGastoCents: 20000,
      month: "2026-01",
      today: "2026-01-10",
    });
    // projected variable = 20000/10*31 = 62000; remaining = 42000
    expect(p).toBe(500000 + 100000 - 20000 - 30000 - 42000);
  });
});

describe("goalMonthlyNeeded", () => {
  it("spreads the remaining over the months until due", () => {
    expect(goalMonthlyNeeded(120000, 20000, "2026-06", "2026-01-01")).toBe(20000); // 100000/5
    expect(goalMonthlyNeeded(120000, 120000, "2026-06", "2026-01-01")).toBe(0);
    expect(goalMonthlyNeeded(120000, 0, null, "2026-01-01")).toBe(120000);
  });
});
