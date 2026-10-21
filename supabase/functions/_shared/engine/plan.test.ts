import { describe, it, expect } from "vitest";
import {
  avisos,
  joanaHistory,
  modelMonth,
  monthControl,
  normalizePlan,
  planMesada,
  planTotals,
  projection,
  seedBudget,
  transitionDefaults,
} from "./plan.ts";
import { monthBreakdown, type EngineCtx, type EngineTx } from "./month.ts";

const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const inc = (id: string, label: string, amount: number, match: string, kind: string, every = 1) => ({
  id, household_id: "h", label, amount_cents: amount, parts: 1, day: 10, every_months: every, anchor_month: "2026-07-01", match_text: match, active: true, kind,
}) as EngineCtx["incomes"][number];
const incomes = [
  inc("i1", "Ordenado Joao", 195157, "ntt data", "salario"),
  inc("i2", "Despesas Joao", 54160, "despesas joao", "representacao"),
  inc("i3", "Renda Casa", 120000, "renda", "renda"),
];
const c = (id: string, grp: string, name: string, budget: number | null, system_role: string | null = null) =>
  ({ id, grp, name, budget_cents: budget, archived: false, merged_into: null, sort: 0, system_role }) as EngineCtx["categories"][number];
const categories = [
  c("ord", "entrada", "Ordenado João", null, "salario"),
  c("eve", "entrada", "Eventos Joana", null, "eventos"),
  c("pre", "fixa", "Prestação casa", 150000),
  c("luz", "fixa", "Luz, água, gás e internet", 20000),
  c("sup", "variavel", "Supermercado", 60000),
  c("res", "variavel", "Restaurantes e cafés", 20000),
  c("rou", "variavel", "Casa e outras compras", 10000),
  c("tra", "atividade", "Trabalho da Joana", 10000),
  c("pj", "mesada", "Para o João", null, "mesada"),
  c("pa", "mesada", "Para a Joana", null, "mesada"),
];
const ctx: EngineCtx = { categories, members, incomes, today: "2026-12-15", firstDataDate: "2026-07-20" };
let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});

describe("planTotals", () => {
  it("R + J − F − V − A − P = what is left for both mesadas", () => {
    const plan = normalizePlan({ joana_cents: 120000, savings_cents: 30000, mesadas: { mj: 50000, ma: 50000 } });
    const p = planTotals(incomes, categories, plan, ["mj", "ma"]);
    expect(p).toMatchObject({ R: 369317, J: 120000, F: 170000, V: 90000, A: 10000, P: 30000 });
    expect(p.D).toBe(369317 + 120000 - 170000 - 90000 - 10000 - 30000);
    expect(p.mesadaPossivel).toBe(94000); // 189 317 / 2 → 946,58 → 940 €
    expect(p.folga).toBe(p.D - 100000);
    expect(p.folgaSemJoana).toBe(p.folga - 120000);
  });
  it("categories paid from the mesada leave the dia a dia; an income every 2 months counts half", () => {
    const plan = normalizePlan({ mesada_covers: ["rou"] });
    const p = planTotals([inc("x", "Bónus", 100000, "x", "outra", 2)], categories, plan, []);
    expect(p).toMatchObject({ R: 50000, V: 80000, mesadaPossivel: 0 });
  });
});

describe("mesadas over time", () => {
  const plan = normalizePlan({ mesadas: { mj: 60000, ma: 60000 }, transition: transitionDefaults(members) });
  it("November is the transition (João 500 €, Joana 0), December the plan", () => {
    expect(transitionDefaults(members)).toEqual({ mj: 50000, ma: 0 });
    expect(planMesada(plan, "mj", "2026-10")).toBe(0);
    expect(planMesada(plan, "mj", "2026-11")).toBe(50000);
    expect(planMesada(plan, "ma", "2026-11")).toBe(0);
    expect(planMesada(plan, "ma", "2026-12")).toBe(60000);
  });
  it("projection from the end of this month", () => {
    const totals = { J: 100000, F: 170000, V: 90000, A: 10000 };
    const p = projection("2026-10", 3, 500000, incomes, totals, plan, ["mj", "ma"]);
    expect(p.map((x) => x.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(p[0]).toMatchObject({ entra: 369317 + 100000, sai: 270000 + 50000 });
    expect(p[1].sai).toBe(270000 + 120000);
    expect(p[1].saldoFim).toBe(500000 + p[0].sobra + p[1].sobra);
  });
  it("projection: what passes to the mesadas is still the house's before the plan's first month", () => {
    const covers = normalizePlan({ ...plan, mesada_covers: ["sup"] });
    const totals = planTotals(incomes, categories, covers, ["mj", "ma"]);
    expect(totals).toMatchObject({ V: 30000, C: 60000 });
    const p = projection("2026-10", 2, 500000, incomes, totals, covers, ["mj", "ma"]);
    // November (transition, 500 € + 0 €): the house still pays the supermarket.
    expect(p[0].sai).toBe(totals.F + 30000 + 60000 + totals.A + 50000);
    // December: the mesadas pay it.
    expect(p[1].sai).toBe(totals.F + 30000 + totals.A + 120000);
    expect(p[1].saldoFim).toBe(500000 + p[0].sobra + p[1].sobra);
    // Without C (older callers) nothing changes.
    expect(projection("2026-10", 1, 0, incomes, { J: 0, F: 0, V: 0, A: 0 }, covers, ["mj", "ma"])[0].sai).toBe(50000);
  });
  it("seedBudget rounds up to 10 €", () => {
    expect(seedBudget(41210)).toBe(42000);
    expect(seedBudget(-5)).toBe(0);
  });
});

describe("joanaHistory and modelMonth", () => {
  const ctxSep = { ...ctx, today: "2026-10-21" };
  const aug = [t("2026-08-20", 100000, "TRF CRED SEPA+ DE JOANA X"), t("2026-08-22", 764388, "Ordenado de Ntt Data Portugal s a", "ord"), t("2026-08-01", -50000, "TRF P/ JOAO"), t("2026-08-26", -569000, "TRF P/ JOAO", null, { pontual: true }), t("2026-08-09", -300000, "X", "sup")];
  const sep = [t("2026-09-20", 150000, "TRF CRED SEPA+ DE JOANA X")];
  const bAug = monthBreakdown(aug, ctxSep, "2026-08", { semPontuais: true });
  const bSep = monthBreakdown(sep, ctxSep, "2026-09", { semPontuais: true });
  it("the prudent Joana value is her weakest month that reached the account", () => {
    const h = joanaHistory([bAug, bSep], { "2026-08": 172500, "2026-09": 247700 });
    expect(h.suggestion).toBe(100000);
    expect(h.share).toBeCloseTo(250000 / 420200, 5);
  });
  it("with the model: normal incomes, Joana's real money, the plan's mesadas", () => {
    const plan = normalizePlan({ mesadas: { mj: 60000, ma: 60000 } });
    const m = modelMonth(bAug, incomes, plan, members);
    expect(m.entradas).toMatchObject({ ordenado: 195157, representacao: 54160, renda: 120000, joana: 100000 });
    expect(m.mesadas).toBe(120000);
    expect(m.sobra).toBe(m.entrou - 300000 - 120000);
    expect(m.pessoas[0]).toMatchObject({ name: "João", levou: 50000, modelo: 60000 });
  });
});

describe("review fixes", () => {
  it("modelMonth: incomes at their monthly value every month; covered categories leave the house", () => {
    const every2 = [inc("r", "Renda", 240000, "renda", "renda", 2)];
    const plan = normalizePlan({ mesada_covers: ["rou"] });
    const rows = [t("2026-08-10", -10000, "ROUPA", "rou"), t("2026-08-11", -20000, "CONTINENTE", "sup")];
    const b = monthBreakdown(rows, { ...ctx, incomes: every2, today: "2026-10-21" }, "2026-08", { semPontuais: true });
    const m = modelMonth(b, every2, plan, members);
    expect(m.entradas.renda).toBe(120000);
    expect(m.casa).toBe(20000);
  });
  it("monthControl: a refund doesn't create more to pay; covers only once the plan is on", () => {
    const rows = [t("2026-12-03", -3000, "SEGURO", "luz"), t("2026-12-15", 8000, "REEMBOLSO", "luz"), t("2026-12-04", -5000, "ROUPA", "rou")];
    const b = monthBreakdown(rows, ctx, "2026-12");
    const draft = monthControl(b, categories, normalizePlan({ mesada_covers: ["rou"] }), "2026-12-15");
    expect(draft.categorias.find((c) => c.categoryId === "luz")!.porSair).toBe(17000);
    expect(draft.categorias.find((c) => c.categoryId === "rou")!.budget).toBe(10000);
    const on = monthControl(b, categories, normalizePlan({ mesada_covers: ["rou"], active: true }), "2026-12-15");
    expect(on.categorias.find((c) => c.categoryId === "rou")!).toMatchObject({ budget: 0, porSair: 0 });
  });
  it("monthControl: a fixed cost charged at about its expected value is paid", () => {
    const cats = [
      c("luz", "fixa", "Luz, água, gás e internet", 13000), // "Usar as médias": 125,60 → 130 €
      c("seg", "fixa", "Seguros", 5000),
      c("pre", "fixa", "Prestação casa", 100000),
      c("con", "fixa", "Condomínio", 6000),
      c("imi", "fixa", "IMI e outras", 500),
    ];
    const rows = [
      t("2026-12-03", -12560, "EDP", "luz"),
      t("2026-12-04", -4300, "SEGURO", "seg"),
      t("2026-12-05", -92000, "PRESTACAO", "pre"),
      t("2026-12-06", -3000, "CONDOMINIO 1/2", "con"),
    ];
    const ctl = monthControl(monthBreakdown(rows, { ...ctx, categories: cats }, "2026-12"), cats, normalizePlan({}), "2026-12-15");
    // Condomínio half paid; IMI not charged at all (even if small).
    expect(ctl.fixasPendentes).toEqual([
      { name: "Condomínio", cents: 3000 },
      { name: "IMI e outras", cents: 500 },
    ]);
    expect(ctl.fixasPorPagar).toBe(3500);
  });
  it("monthControl: with a refund, the dia a dia still to go is what the hero says they can still spend", () => {
    const rows = [
      t("2026-12-05", -20000, "CONTINENTE", "sup"),
      t("2026-12-10", 5000, "DEVOLUCAO CONTINENTE", "sup"),
      t("2026-12-14", -2000, "PINGO DOCE", "sup", { source: "applepay" }),
    ];
    const ctl = monthControl(monthBreakdown(rows, ctx, "2026-12"), categories, normalizePlan({}), "2026-12-15");
    expect(ctl.diaLeft).toBe(90000 - 17000);
    const dia = ctl.categorias.filter((x) => x.grp === "variavel").reduce((a, x) => a + x.porSair, 0);
    expect(dia).toBe(ctl.diaLeft);
    // Early in the month too.
    const early = monthControl(monthBreakdown(rows, { ...ctx, today: "2026-12-14" }, "2026-12"), categories, normalizePlan({}), "2026-12-05");
    expect(early.categorias.find((x) => x.categoryId === "sup")!.porSair).toBe(60000 - 17000);
  });
});

describe("monthControl and avisos", () => {
  const plan = normalizePlan({ mesadas: { mj: 60000 } });
  const rows = [
    t("2026-12-02", -150000, "PRESTACAO", "pre"),
    t("2026-12-05", -55000, "CONTINENTE", "sup"),
    t("2026-12-10", -15000, "REST", "res"),
    t("2026-12-01", -70000, "TRF P/ JOAO"),
  ];
  const b = monthBreakdown(rows, ctx, "2026-12");
  const ctl = monthControl(b, categories, plan, "2026-12-15");
  it("what is left for the dia a dia and the fixed costs still to pay", () => {
    expect(ctl).toMatchObject({ day: 15, daysLeft: 17, diaLimit: 90000, diaSpent: 70000, diaLeft: 20000 });
    expect(ctl.perDay).toBe(Math.floor(20000 / 17));
    expect(ctl.fixasPorPagar).toBe(20000);
    expect(ctl.fixasPendentes).toEqual([{ name: "Luz, água, gás e internet", cents: 20000 }]);
    const sup = ctl.categorias.find((x) => x.categoryId === "sup")!;
    expect(sup.level).toBe("warn");
    expect(sup.porSair).toBe(Math.max(60000, Math.round((55000 / 15) * 31)) - 55000);
  });
  it("avisos, most severe first", () => {
    const a = avisos(ctl, b, (id) => (id === "mj" ? 60000 : 0), [{ label: "A renda", day: 8, cents: 120000 }]);
    expect(a.map((x) => x.level)).toEqual(["warn", "warn", "warn", "info"]);
    expect(a.some((x) => x.text.startsWith("João já levou 700 €"))).toBe(true);
    expect(a[a.length - 1].text).toBe("A renda ainda não entrou (costuma ser dia 8).");
  });
});
