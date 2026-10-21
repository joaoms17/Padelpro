import { describe, it, expect } from "vitest";
import { isSemCategoria, semCategoria, semCategoriaBanner, semCategoriaLabel } from "./semCategoria";
import { monthBreakdown, type EngineCtx, type EngineTx } from "./month";
import { reviewCount } from "./esteMes";

const cat = (id: string, grp: string, name: string, system_role: string | null = null) =>
  ({ id, grp, name, system_role, archived: false, merged_into: null, sort: 0, budget_cents: null }) as EngineCtx["categories"][number];
const ctx: EngineCtx = {
  categories: [cat("ord", "entrada", "Ordenado João", "salario"), cat("sup", "variavel", "Supermercado"), cat("pj", "mesada", "Para o João", "mesada")],
  members: [
    { id: "mj", display_name: "João" },
    { id: "ma", display_name: "Joana" },
  ],
  incomes: [
    { id: "i2", household_id: "h", label: "Despesas Joao", amount_cents: 54160, parts: 1, day: 10, every_months: 1, anchor_month: "2026-07-01", match_text: "despesas joao", active: true, kind: "representacao" } as EngineCtx["incomes"][number],
  ],
  today: "2026-10-21",
  firstDataDate: "2026-07-01",
};
const sp = (s: string) => s.replace(/ /g, " ");
let n = 0;
const t =(date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `s${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});

// August as in the review: 3 shops the app can't place, and 5 movements it
// already places on its own (transfers naming João, representação, Joana).
const august = [
  t("2026-08-04", -4599, "TEMU.COM DUBLIN"),
  t("2026-08-09", -3999, "PROZIS"),
  t("2026-08-15", -5302, "GALP S JOAO"),
  t("2026-08-01", -50000, "TRF IMED P/ JOAO MANUEL SILVA"),
  t("2026-08-25", -569000, "TRF IMED P/ JOAO MANUEL SILVA"),
  t("2026-08-10", 54160, "TRF DESPESAS JOAO"),
  t("2026-08-11", 54160, "TRF DESPESAS JOAO"),
  t("2026-08-20", 100000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES"),
  t("2026-08-03", -30000, "COMPRA CONTINENTE", "sup"),
  t("2026-08-05", -999, "CAFE (NOTA)", null, { source: "applepay" }),
  t("2026-09-02", -1200, "PINGO DOCE"),
];

describe("sem categoria: one rule for Movimentos, Meses and Este mês", () => {
  it("is a movement with no category, Apple Pay notes aside", () => {
    expect(isSemCategoria({ category_id: null, source: "banco" })).toBe(true);
    expect(isSemCategoria({ category_id: null, source: "extrato" })).toBe(true);
    expect(isSemCategoria({ category_id: "sup", source: "banco" })).toBe(false);
    expect(isSemCategoria({ category_id: null, source: "applepay" })).toBe(false);
  });

  it("counts every movement without a category, also those the engine already places", () => {
    const b = monthBreakdown(august, ctx, "2026-08");
    expect(b.semCount).toBe(3);
    const sem = semCategoria(august, "2026-08");
    expect(sem.map((x) => x.description_raw)).toEqual([
      "TEMU.COM DUBLIN",
      "PROZIS",
      "GALP S JOAO",
      "TRF IMED P/ JOAO MANUEL SILVA",
      "TRF IMED P/ JOAO MANUEL SILVA",
      "TRF DESPESAS JOAO",
      "TRF DESPESAS JOAO",
      "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES",
    ]);
    // Every one the engine can't place is among them.
    expect(b.semIds.every((id) => sem.some((x) => x.id === id))).toBe(true);
    expect(semCategoria(august).length).toBe(9);
    // Este mês' chip counts the same (every month).
    expect(reviewCount(august, "2026-10").sem).toBe(9);
  });

  it("words the count and whether the totals still wait for it", () => {
    expect(semCategoriaLabel(1)).toBe("1 movimento sem categoria");
    expect(semCategoriaLabel(8)).toBe("8 movimentos sem categoria");
    expect(sp(semCategoriaBanner(3, 13900, 3))).toBe("3 movimentos sem categoria (139 €). Enquanto não forem categorizados, os totais estão incompletos.");
    expect(sp(semCategoriaBanner(1, 1250, 1))).toBe("1 movimento sem categoria (13 €). Enquanto não for categorizado, os totais estão incompletos.");
    expect(sp(semCategoriaBanner(8, 632900, 3))).toBe(
      "8 movimentos sem categoria (6 329 €). A app não sabe onde pôr 3 deles: enquanto não forem categorizados, os totais estão incompletos.",
    );
    expect(sp(semCategoriaBanner(5, 619000, 1))).toBe(
      "5 movimentos sem categoria (6 190 €). A app não sabe onde pôr um deles: enquanto não for categorizado, os totais estão incompletos.",
    );
    expect(sp(semCategoriaBanner(5, 619000, 0))).toBe(
      "5 movimentos sem categoria (6 190 €). Já contam nos totais (a app reconhece-os pela descrição) — categoriza-os para confirmar.",
    );
    expect(sp(semCategoriaBanner(1, 50000, 0))).toBe(
      "1 movimento sem categoria (500 €). Já conta nos totais (a app reconhece-o pela descrição) — categoriza-o para confirmar.",
    );
  });
});
