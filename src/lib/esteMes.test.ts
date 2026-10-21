import { describe, it, expect } from "vitest";
import {
  applePayPending,
  bankNotes,
  bankPending,
  comArtigo,
  forecastParts,
  incomeProgress,
  mesadaRows,
  monthsLabel,
  prepSteps,
  reviewCount,
  semSaiuBySource,
  sinceLabel,
} from "./esteMes";
import { monthBreakdown, type EngineCtx, type EngineTx } from "./month";
import { monthControl, normalizePlan, planTotals } from "./plan";

const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const inc = (id: string, label: string, amount: number, match: string, kind: string, day: number, parts = 1) =>
  ({ id, household_id: "h", label, amount_cents: amount, parts, day, every_months: 1, anchor_month: "2026-07-01", match_text: match, active: true, kind }) as EngineCtx["incomes"][number];
const incomes = [
  inc("i1", "Ordenado Joao", 195157, "ntt data", "salario", 23),
  inc("i2", "Despesas Joao", 54160, "despesas joao", "representacao", 10),
  inc("i3", "Renda Casa", 120000, "renda", "renda", 8),
];
const c = (id: string, grp: string, name: string, budget: number | null = null, system_role: string | null = null) =>
  ({ id, grp, name, budget_cents: budget, archived: false, merged_into: null, sort: 0, system_role }) as EngineCtx["categories"][number];
const categories = [
  c("ord", "entrada", "Ordenado João", null, "salario"),
  c("ren", "entrada", "Renda casa arrendada", null, "renda"),
  c("pre", "fixa", "Prestação casa", 85000),
  c("seg", "fixa", "Seguros", 9000),
  c("sup", "variavel", "Supermercado", 60000),
  c("res", "variavel", "Restaurantes e cafés", 25000),
  c("tra", "atividade", "Trabalho da Joana", 15000),
  c("pj", "mesada", "Para o João", null, "mesada"),
  c("pa", "mesada", "Para a Joana", null, "mesada"),
];
const ctx: EngineCtx = { categories, members, incomes, today: "2026-10-21", firstDataDate: "2026-07-20" };
let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});

const october = [
  t("2026-10-08", 120000, "TRF CRED SEPA+ DE INQUILINO RENDA", "ren"),
  t("2026-10-10", 54160, "TRF DESPESAS JOAO"),
  t("2026-10-01", -50000, "TRF IMED P/ JOAO MANUEL SILVA"),
  t("2026-10-15", -20000, "TRF IMED P/ JOAO MANUEL SILVA", null, { pontual: true }),
  t("2026-10-05", -85000, "PRESTACAO EMPRESTIMO", "pre"),
  t("2026-10-03", -30000, "COMPRA CONTINENTE", "sup"),
  t("2026-10-19", -1450, "CAFE CENTRAL", "res", { source: "applepay" }),
  t("2026-10-02", -999, "APPLE PAY ANTIGA", "res", { source: "applepay" }),
  t("2026-10-12", -2899, "TEMU.COM DUBLIN"),
  t("2026-09-12", -1799, "NETFLIX.COM", "res", { category_source: "sugestao" }),
];
const real = monthBreakdown(october, ctx, "2026-10");
const sem = monthBreakdown(october, ctx, "2026-10", { semPontuais: true });

describe("sinceLabel / bankNotes", () => {
  const now = Date.parse("2026-10-21T10:00:00Z");
  it("says how long ago, in minutes, hours or days", () => {
    expect(sinceLabel("2026-10-21T09:59:30Z", now)).toBe("agora mesmo");
    expect(sinceLabel("2026-10-21T09:15:00Z", now)).toBe("há 45 min");
    expect(sinceLabel("2026-10-21T07:00:00Z", now)).toBe("há 3 h");
    expect(sinceLabel("2026-10-20T08:00:00Z", now)).toBe("há 1 dia");
    expect(sinceLabel("2026-10-18T08:00:00Z", now)).toBe("há 3 dias");
  });
  it("grey while fresh, amber after 36 h, and the consent from 14 days before it ends", () => {
    expect(bankNotes("2026-10-21T07:00:00Z", "2027-04-10T00:00:00Z", now)).toEqual([{ tone: "grey", text: "Banco atualizado há 3 h" }]);
    const stale = bankNotes("2026-10-19T08:00:00Z", "2026-10-26T00:00:00Z", now);
    expect(stale.map((x) => [x.tone, x.text, x.action?.to])).toEqual([
      ["amber", "Banco sem atualizar há 2 dias", "/ligar-banco"],
      ["amber", "A ligação ao Santander expira em 5 dias", "/ligar-banco"],
    ]);
    expect(bankNotes("2026-10-21T07:00:00Z", "2026-10-23T00:00:00Z", now)[1]).toMatchObject({ tone: "red", text: "A ligação ao Santander expira em 2 dias" });
    expect(bankNotes("2026-10-21T07:00:00Z", "2026-10-20T00:00:00Z", now)[1]).toMatchObject({ tone: "red", text: "A ligação ao Santander expirou" });
    expect(bankNotes(null, null, now)).toEqual([{ tone: "amber", text: "Banco ainda não ligado", action: { label: "Ligar", to: "/ligar-banco" } }]);
  });
  it("the consent in calendar days (Lisbon): 'hoje' on its last day, like the push", () => {
    const consent = (until: string, at = now) => bankNotes("2026-10-21T07:00:00Z", until, at)[1]?.text;
    expect(consent("2026-10-21T17:57:00Z")).toBe("A ligação ao Santander expira hoje");
    expect(consent("2026-10-22T17:57:00Z")).toBe("A ligação ao Santander expira amanhã");
    // Late in the evening, a link ending tomorrow afternoon is still "amanhã".
    expect(consent("2026-10-22T17:57:00Z", Date.parse("2026-10-21T22:30:00Z"))).toBe("A ligação ao Santander expira amanhã");
    // 3,33 days away: "em 3 dias" (not 4).
    expect(consent("2026-10-24T18:00:00Z")).toBe("A ligação ao Santander expira em 3 dias");
    expect(consent("2026-10-21T09:00:00Z")).toBe("A ligação ao Santander expirou");
  });
});

describe("reviewCount / applePayPending", () => {
  it("counts every month's movements to review (no Apple Pay notes) and links to all months when needed", () => {
    expect(reviewCount(october, "2026-10")).toEqual({ sem: 4, validar: 1, to: "/movimentos?vista=categorizar" });
    const onlyOld = [t("2026-09-01", -100, "X"), t("2026-10-01", -100, "Y", "sup")];
    expect(reviewCount(onlyOld, "2026-10").to).toBe("/movimentos?vista=categorizar&mes=todos");
    expect(reviewCount([t("2026-09-12", -1799, "NETFLIX", "res", { category_source: "ai" })], "2026-10")).toEqual({ sem: 0, validar: 1, to: "/movimentos?vista=validar&mes=todos" });
  });
  it("Apple Pay notes still waiting for the bank (≤ 5 days old) are still to leave the balance", () => {
    expect(applePayPending(october, "2026-10", "2026-10-21")).toBe(1450);
  });
  it("bank movements still pending are not in the booked balance yet", () => {
    const rows = [
      t("2026-10-20", -8000, "COMPRA CONTINENTE", "sup", { status: "provisorio" }),
      t("2026-09-30", -1500, "COMPRA CAFE", "res", { status: "provisorio" }),
      t("2026-10-20", 2500, "TRF CRED DE ALGUEM", null, { status: "provisorio" }),
      t("2026-11-01", -60000, "TRF AGENDADA P/ JOAO", null, { status: "provisorio" }), // scheduled for next month
      t("2026-10-19", -1450, "CAFE", "res", { source: "applepay", status: "provisorio" }), // a note, not the bank
      t("2026-10-18", -3000, "COMPRA LIDL", "sup", { status: "confirmado" }),
    ];
    expect(bankPending(rows, "2026-10")).toEqual({ out: 9500, in: 2500 });
  });
  it("what has no category, apart: bank movements and Apple Pay notes", () => {
    const rows = [t("2026-10-12", -2899, "TEMU"), t("2026-10-20", -1500, "CAFE X", null, { source: "applepay" }), t("2026-10-11", 1000, "TRF CRED DE ALGUEM")];
    const b = monthBreakdown(rows, ctx, "2026-10");
    expect(semSaiuBySource(b, rows)).toEqual({ banco: 2899, applePay: 1500 });
  });
});

describe("incomeProgress", () => {
  it("what arrived by kind (a categorized renda, the representação by its keyword), and what is missing", () => {
    const p = incomeProgress(incomes, real);
    expect(p.groups.map((g) => [g.label, g.arrived, g.pending])).toEqual([
      ["Ordenado", 0, 195157],
      ["Representação", 54160, 0],
      ["Renda", 120000, 0],
    ]);
    expect(p.expected).toBe(195157 + 54160 + 120000);
    expect(p.arrived).toBe(174160);
    expect(p.missing.map((g) => [g.label, g.day])).toEqual([["Ordenado", 23]]);
  });
  it("a salary a little lower than usual has arrived; one of two transfers is half", () => {
    const b = monthBreakdown([t("2026-10-22", 185000, "Ordenado de Ntt Data Portugal", "ord"), t("2026-10-09", 54160, "TRF DESPESAS JOAO")], ctx, "2026-10");
    const two = [incomes[0], inc("i2", "Despesas Joao", 108320, "despesas joao", "representacao", 10, 2)];
    const p = incomeProgress(two, b);
    expect(p.groups.map((g) => [g.kind, g.pending])).toEqual([["salario", 0], ["representacao", 54160]]);
  });
  it("only incomes due this month count; an 'outra' income keeps its own name", () => {
    const every2 = { ...inc("i9", "Bónus anual", 50000, "bonus", "outra", 15), every_months: 2, anchor_month: "2026-09-01" };
    expect(incomeProgress([every2], real).groups).toEqual([]);
    expect(incomeProgress([{ ...every2, anchor_month: "2026-10-01" }], real).groups[0]).toMatchObject({ label: "Bónus anual", pending: 50000 });
  });
});

describe("mesadaRows / forecastParts", () => {
  const mesadaOf = (id: string) => (id === "mj" ? 50000 : 30000);
  const rows = mesadaRows(members, sem, real, mesadaOf);
  it("each one's mesada against what they took (one-offs apart)", () => {
    expect(rows).toEqual([
      { memberId: "mj", name: "João", mesada: 50000, levou: 50000, pontual: 20000, alem: 0, porSair: 0 },
      { memberId: "ma", name: "Joana", mesada: 30000, levou: 0, pontual: 0, alem: 0, porSair: 30000 },
    ]);
    expect(mesadaRows(members, sem, real, () => 40000)[0]).toMatchObject({ alem: 10000, porSair: 0 });
  });
  it("still to come in and to go out: incomes missing, Joana's Duet money, fixas, mesadas, dia a dia, Apple Pay", () => {
    const plan = normalizePlan({});
    const control = monthControl(sem, categories, plan, "2026-10-21");
    const f = forecastParts({ control, incomes: incomeProgress(incomes, real), joana: { duet: 100000, arrived: 40000 }, mesadas: rows, applePay: 1450 });
    expect(f.toCome).toEqual([
      { label: "Ordenado (dia 23)", cents: 195157 },
      { label: "Joana (da Duet, por chegar)", cents: 60000 },
    ]);
    const dia = control.categorias.filter((x) => x.grp === "variavel").reduce((a, x) => a + x.porSair, 0);
    expect(f.toGo).toEqual([
      { label: "Contas fixas por pagar", cents: 9000 },
      { label: "Mesadas por sair", cents: 30000 },
      { label: "Dia a dia até ao fim", cents: dia },
      { label: "Trabalho da Joana até ao fim", cents: 15000 },
      { label: "Apple Pay ainda por descontar", cents: 1450 },
    ]);
    expect(dia).toBe(60000 - 30000 + 25000 - 1450);
    // Joana already put in all she received on Duet: nothing more to come from her.
    const f2 = forecastParts({ control, incomes: { missing: [] }, joana: { duet: 100000, arrived: 120000 }, mesadas: [], applePay: 0 });
    expect(f2.toCome).toEqual([]);
    // A difference marked as not owed is not expected either.
    const f3 = forecastParts({ control, incomes: { missing: [] }, joana: { duet: 100000, arrived: 40000, waived: 60000 }, mesadas: [], applePay: 0 });
    expect(f3.toCome).toEqual([]);
  });
  it("pending bank movements: still to leave (or come into) the booked balance", () => {
    const control = monthControl(sem, categories, normalizePlan({}), "2026-10-21");
    const f = forecastParts({ control, incomes: { missing: [] }, joana: null, mesadas: [], applePay: 1450, pending: { out: 8000, in: 2500 } });
    expect(f.toCome).toEqual([{ label: "Entradas pendentes no banco", cents: 2500 }]);
    expect(f.toGo.slice(-2)).toEqual([
      { label: "Apple Pay ainda por descontar", cents: 1450 },
      { label: "Pagamentos pendentes no banco", cents: 8000 },
    ]);
  });
});

describe("prepSteps", () => {
  const closed = [
    { month: "2026-08", porValidar: 0 },
    { month: "2026-09", porValidar: 2 },
  ];
  // September: a shop, a transfer to João and representação the engine
  // already places by name/words — all three still without a category.
  const txs = [
    t("2026-08-03", -30000, "COMPRA CONTINENTE", "sup"),
    t("2026-09-02", -2899, "TEMU.COM DUBLIN"),
    t("2026-09-01", -50000, "TRF IMED P/ JOAO MANUEL SILVA"),
    t("2026-09-10", 54160, "TRF DESPESAS JOAO"),
    t("2026-09-11", -999, "APPLE PAY NOTA", null, { source: "applepay" }),
    t("2026-10-12", -2899, "TEMU.COM DUBLIN"),
  ];
  const totals = planTotals(incomes, categories, normalizePlan({}), ["mj", "ma"]);
  it("the five steps to the plan, each with its link (Joana's money is read from Duet, not set)", () => {
    const s = prepSteps({ closed, txs, incomes: [], plan: normalizePlan({}), categories: categories.map((x) => ({ ...x, budget_cents: null })), totals, members });
    expect(s.map((x) => [x.key, x.done])).toEqual([
      ["categorizar", false],
      ["entradas", false],
      ["fixas", false],
      ["dia", false],
      ["mesadas", false],
    ]);
    expect(s[0]).toMatchObject({ label: "Categorizar agosto e setembro", sub: "3 sem categoria · 2 por confirmar", to: "/movimentos?mes=2026-09&vista=categorizar" });
    expect(s.map((x) => x.to).slice(1)).toEqual(["/plano#entradas", "/plano#fixas", "/plano#dia-a-dia", "/plano#mesadas"]);
    expect(s.some((x) => /Joana/.test(x.label))).toBe(false);
  });
  it("ticks what is filled in", () => {
    const plan = normalizePlan({ mesadas: { mj: 60000, ma: 60000 } });
    const filed = txs.map((x) => (x.booking_date.startsWith("2026-09") ? { ...x, category_id: "sup" } : x));
    const s = prepSteps({ closed, txs: filed, incomes, plan, categories, totals, members });
    expect(s.every((x) => x.done)).toBe(false);
    expect(s[0]).toMatchObject({ done: false, sub: "2 por confirmar", to: "/movimentos?mes=2026-09&vista=validar" });
    expect(s.slice(1).every((x) => x.done)).toBe(true);
    const all = prepSteps({ closed: [closed[0]], txs, incomes, plan: { ...plan, active: true }, categories, totals, members });
    expect(all.every((x) => x.done)).toBe(true);
    expect(all[0].label).toBe("Categorizar agosto");
    expect(all).toHaveLength(5);
    expect(all[4].sub.startsWith("Em vigor")).toBe(true);
  });
  it("counts what Movimentos lists as por categorizar, also what the engine already places", () => {
    const sept = monthBreakdown(txs, ctx, "2026-09");
    // The engine can't place only the shop (the transfer and representação it can)…
    expect(sept.semCount).toBe(1);
    // …but the step waits for every movement without a category, as Movimentos and the chip count them.
    const s = prepSteps({ closed: [{ month: "2026-09", porValidar: 0 }], txs, incomes, plan: normalizePlan({}), categories, totals, members });
    expect(s[0]).toMatchObject({ done: false, sub: "3 sem categoria" });
    expect(reviewCount(txs, "2026-10").sem).toBe(4);
  });
});

describe("words", () => {
  it("articles and month lists", () => {
    expect(comArtigo("João")).toBe("o João");
    expect(comArtigo("Joana")).toBe("a Joana");
    expect(monthsLabel(["2026-08", "2026-09"])).toBe("agosto e setembro");
    expect(monthsLabel(["2026-07", "2026-08", "2026-09"])).toBe("julho, agosto e setembro");
    expect(monthsLabel(["2026-03", "2026-04", "2026-05", "2026-06", "2026-09"])).toBe("de março a setembro");
  });
});
