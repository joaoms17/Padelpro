import { describe, it, expect } from "vitest";
import {
  applyBudgets,
  budgetRows,
  casaArrendada,
  centsInput,
  commonMesada,
  coveredMean,
  currentMonthRest,
  duetByMonth,
  duetFrom,
  euroNum,
  freqText,
  incomeCredits,
  mesadaChecklist,
  monthsList,
  monthsOfHouse,
  monthsText,
  ofName,
  parseInput,
  peopleAverages,
  projMonthLabel,
  realityCheck,
  seedFromMeans,
  setAllMesadas,
  startLabel,
  stepsDone,
  suggestionCredits,
  theName,
  withDefaults,
  withDuetRange,
} from "./planView";
import { monthBreakdown, referenceAverages, type EngineCtx, type EngineTx } from "./month";
import { normalizePlan } from "./plan";
import { formatEuros } from "./format";

const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const cat = (id: string, grp: string, name: string, budget: number | null = null, sort = 0, system_role: string | null = null) =>
  ({ id, grp, name, budget_cents: budget, archived: false, merged_into: null, sort, system_role }) as EngineCtx["categories"][number];
const categories = [
  cat("ord", "entrada", "Ordenado João", null, 0, "salario"),
  cat("ren", "entrada", "Renda casa arrendada", null, 1, "renda"),
  cat("eve", "entrada", "Eventos Joana", null, 2, "eventos"),
  cat("pre", "fixa", "Prestação casa", 85000, 10),
  cat("arr", "fixa", "Prestação casa arrendada", null, 11),
  cat("luz", "fixa", "Luz, água, gás e internet", null, 12),
  cat("sup", "variavel", "Supermercado", null, 21),
  cat("nut", "variavel", "Nutrição e suplementos", null, 20),
  cat("tra", "atividade", "Trabalho da Joana", null, 30),
  cat("pj", "mesada", "Para o João", null, 40, "mesada"),
  cat("pou", "interna", "Poupança", null, 50),
];
const inc = (id: string, label: string, amount: number, match: string, kind: string, every = 1) =>
  ({ id, household_id: "h", label, amount_cents: amount, parts: 1, day: 8, every_months: every, anchor_month: "2026-07-01", match_text: match, active: true, kind }) as EngineCtx["incomes"][number];
const incomes = [inc("i1", "Ordenado Joao", 195157, "ntt data", "salario"), inc("i3", "Renda Casa", 120000, "inquilino", "renda")];
const ctx: EngineCtx = { categories, members, incomes, today: "2026-10-21", firstDataDate: "2026-07-20" };
let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});
const txs = [
  t("2026-08-22", 195157, "Ordenado de Ntt Data Portugal s a", "ord"),
  t("2026-08-08", 120000, "TRF CRED SEPA+ DE INQUILINO RENDA", "ren"),
  t("2026-08-05", -62000, "PRESTACAO EMPRESTIMO 2", "arr"),
  t("2026-08-06", -6420, "DD EDP", "luz"),
  t("2026-08-10", -30010, "COMPRA CONTINENTE", "sup"),
  t("2026-08-11", -4999, "PROZIS.COM", "nut"),
  t("2026-08-20", 100000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES"),
  t("2026-09-22", 195157, "Ordenado de Ntt Data Portugal s a", "ord"),
  t("2026-09-08", 120000, "TRF CRED SEPA+ DE INQUILINO RENDA", "ren"),
  t("2026-09-05", -62000, "PRESTACAO EMPRESTIMO 2", "arr"),
  t("2026-09-06", -7420, "DD EDP", "luz"),
  t("2026-09-10", -41990, "COMPRA CONTINENTE", "sup"),
  t("2026-09-12", 2500, "DEVOLUCAO CONTINENTE", "sup"),
  t("2026-09-25", -20000, "TRF P/ CONTA POUPANCA", "pou"),
  t("2026-09-26", 5000, "TRF DE CONTA POUPANCA", "pou"),
  t("2026-09-27", 3000, "TRF IMED DE JOAO MANUEL SILVA"),
];
const months = ["2026-08", "2026-09"];
const breakdowns = new Map(months.map((m) => [m, monthBreakdown(txs, ctx, m, { semPontuais: true })]));
const averages = referenceAverages([...breakdowns.values()]);

describe("text helpers", () => {
  it("frequency, month lists and labels", () => {
    expect(freqText(1)).toBe("todos os meses");
    expect(freqText(2)).toBe("a cada 2 meses");
    expect(freqText(12)).toBe("uma vez por ano");
    expect(monthsList(["2026-08"])).toBe("ago");
    expect(monthsList(["2026-08", "2026-09"])).toBe("ago e set");
    expect(monthsList(["2026-08", "2026-09", "2026-10"])).toBe("ago, set e out");
    expect(monthsList(["2026-08", "2026-09"], true)).toBe("agosto e setembro");
    expect(projMonthLabel("2026-11")).toBe("Nov");
    expect(projMonthLabel("2027-01")).toBe("Jan 2027");
    expect(startLabel("2026-12")).toBe("dezembro 2026");
    expect(ofName("João")).toBe("do João");
    expect(ofName("Joana")).toBe("da Joana");
    expect(theName("Joana")).toBe("a Joana");
    expect(monthsText(1)).toBe("1 mês");
    expect(monthsText(1.4)).toBe("1,4 meses");
  });
  it("euro fields: typed text ↔ cents", () => {
    expect(centsInput(null)).toBe("");
    expect(centsInput(85000)).toBe("850");
    expect(centsInput(1250)).toBe("12,50");
    expect(parseInput("")).toBeNull();
    expect(parseInput("  ")).toBeNull();
    expect(parseInput("850")).toBe(85000);
    expect(parseInput("12,5")).toBe(1250);
    expect(parseInput("1.234,56")).toBe(123456);
    expect(parseInput("abc")).toBe("invalid");
    expect(parseInput("-20")).toBe(0);
    expect(euroNum(0)).toBe("—");
    expect(euroNum(-1500)).toBe("−15");
  });
});

describe("budget tables", () => {
  it("rows per category in order, with each month, the average and the plan's value", () => {
    const rows = budgetRows(categories, "variavel", months, breakdowns, averages);
    expect(rows.map((r) => r.id)).toEqual(["nut", "sup"]);
    const sup = rows.find((r) => r.id === "sup")!;
    expect(sup.perMonth).toEqual({ "2026-08": 30010, "2026-09": 39490 }); // the refund lowers September
    expect(sup.mean).toBe(34750);
    expect(sup.budget).toBeNull();
    const nut = rows.find((r) => r.id === "nut")!;
    expect(nut.perMonth["2026-09"]).toBe(0);
    expect(nut.mean).toBe(2500); // 49,99 € in one of two months
    const fixas = budgetRows(categories, "fixa", months, breakdowns, averages);
    expect(fixas.map((r) => [r.id, r.budget])).toEqual([["pre", 85000], ["arr", null], ["luz", null]]);
  });
  it("'Usar as médias' rounds up to 10 € and skips what cost nothing", () => {
    const rows = budgetRows(categories, "fixa", months, breakdowns, averages);
    expect(seedFromMeans(rows)).toEqual({ arr: 62000, luz: 7000 });
  });
  it("limits changed on screen apply before the reload", () => {
    const out = applyBudgets(categories, { sup: 40000, pre: null });
    expect(out.find((c) => c.id === "sup")!.budget_cents).toBe(40000);
    expect(out.find((c) => c.id === "pre")!.budget_cents).toBeNull();
    expect(applyBudgets(categories, {})).toBe(categories);
  });
  it("the rented house: rent minus its loan", () => {
    expect(casaArrendada(categories, incomes, averages)).toEqual({ renda: 120000, prestacao: 62000, net: 58000 });
    const withBudget = applyBudgets(categories, { arr: 65000 });
    expect(casaArrendada(withBudget, [], averages)).toEqual({ renda: 120000, prestacao: 65000, net: 55000 });
    expect(casaArrendada(categories.filter((c) => c.id !== "arr"), incomes, averages)).toBeNull();
  });
});

describe("steps and checks", () => {
  it("which steps are filled", () => {
    const plan = normalizePlan({});
    const s = stepsDone(incomes, categories, plan, ["mj", "ma"]);
    expect(s).toEqual({ entradas: true, joana: false, fixas: true, dia: false, poupanca: false, mesadas: false, ready: false });
    const full = stepsDone(incomes, applyBudgets(categories, { sup: 40000 }), normalizePlan({ joana_cents: 0, savings_cents: 100, mesadas: { mj: 1 } }), ["mj", "ma"]);
    expect(full).toEqual({ entradas: true, joana: true, fixas: true, dia: true, poupanca: true, mesadas: true, ready: true });
  });
  it("the house in the plan against the reference months", () => {
    const r = realityCheck(averages, { F: 150000, V: 30000, A: 0 }, [])!;
    expect(r.months).toEqual(months);
    expect(r.casaMedia).toBe(averages.casa);
    expect(r.casaPlano).toBe(180000);
    expect(r.ok).toBe(averages.casa <= 180000);
    // What moves to the mesadas no longer counts as the house's.
    expect(coveredMean(averages, ["nut"])).toBe(2500);
    expect(realityCheck(averages, { F: 0, V: 0, A: 0 }, ["nut"])!.casaMedia).toBe(averages.casa - 2500);
    expect(realityCheck({ months: [], casa: 0, categorias: new Map() }, { F: 0, V: 0, A: 0 }, [])).toBeNull();
  });
  it("what each one took on average", () => {
    expect(peopleAverages(members, { mj: 60000, ma: 0 })).toBe(`o João passou para si em média ${formatEuros(60000)} e a Joana ${formatEuros(0)}`);
  });
  it("months of house costs in the balance", () => {
    expect(monthsOfHouse(null, 100)).toBeNull();
    expect(monthsOfHouse(500000, 0)).toBeNull();
    expect(monthsOfHouse(412345, 300000)).toBe(1.3);
    expect(monthsOfHouse(-5000, 300000)).toBe(0);
  });
});

describe("mesadas", () => {
  it("November's defaults only when none were chosen", () => {
    expect(withDefaults(normalizePlan({}), members).transition).toEqual({ mj: 50000, ma: 0 });
    expect(withDefaults(normalizePlan({ transition: { mj: 0 } }), members).transition).toEqual({ mj: 0 });
  });
  it("one value for both", () => {
    const p = setAllMesadas(normalizePlan({}), ["mj", "ma"], 60000);
    expect(p.mesadas).toEqual({ mj: 60000, ma: 60000 });
    expect(commonMesada(p, ["mj", "ma"])).toBe(60000);
    expect(commonMesada({ ...p, mesadas: { mj: 60000, ma: 50000 } }, ["mj", "ma"])).toBeNull();
    expect(commonMesada(normalizePlan({}), ["mj", "ma"])).toBe(0);
  });
  it("what to change in the bank", () => {
    const plan = normalizePlan({ mesadas: { mj: 60000, ma: 60000 }, transition: { mj: 50000, ma: 0 }, mesada_day: 2 });
    expect(mesadaChecklist(plan, members)).toEqual([
      `Mudar a transferência automática do João de ${formatEuros(50000)} para ${formatEuros(60000)} (dia 2)`,
      `Criar a transferência automática da Joana de ${formatEuros(60000)} (dia 2)`,
    ]);
    const same = normalizePlan({ mesadas: { mj: 50000, ma: 0 }, transition: { mj: 50000, ma: 0 } });
    expect(mesadaChecklist(same, members)).toEqual([`Manter a transferência automática do João de ${formatEuros(50000)} (dia 1)`]);
    const none = normalizePlan({ mesadas: { mj: 0 }, transition: { mj: 50000 } });
    expect(mesadaChecklist(none, members)).toEqual([`Cancelar a transferência automática do João de ${formatEuros(50000)}`]);
  });
});

describe("Joana and the bank", () => {
  it("Duet receipts per month", () => {
    expect(
      duetByMonth([
        { date: "2026-08-10", amount_cents: 1000 },
        { date: "2026-08-30", amount_cents: 500 },
        { date: "2026-09-01", amount_cents: 200 },
      ]),
    ).toEqual({ "2026-08": 1500, "2026-09": 200 });
  });
  it("credits that may be a regular income: not Joana, not one of you, not savings, not refunds", () => {
    const ids = incomeCredits(txs, ctx, "2026-08-01").map((c) => c.description_raw);
    expect(ids).toEqual([
      "Ordenado de Ntt Data Portugal s a",
      "TRF CRED SEPA+ DE INQUILINO RENDA",
      "Ordenado de Ntt Data Portugal s a",
      "TRF CRED SEPA+ DE INQUILINO RENDA",
    ]);
    expect(incomeCredits(txs, ctx, "2026-09-01").map((c) => c.key)).toEqual(["ordenado", "renda"]);
    expect(incomeCredits([t("2026-10-01", 900, "APPLE PAY NOTE", null, { source: "applepay" })], ctx, "2026-01-01")).toHaveLength(0);
  });
  it("bank suggestions leave out what a set-up income already explains", () => {
    const credits = [
      ...incomeCredits(txs, ctx, "2026-08-01"),
      { id: "x", booking_date: "2026-09-02", amount_cents: 30000, description_raw: "TRF CRED SEPA+ DE EMPRESA X", key: "sem" as const },
    ];
    // The salary and the rent are set up (other keywords, but filed under their categories).
    expect(suggestionCredits(credits, incomes).map((c) => c.id)).toEqual(["x"]);
    expect(suggestionCredits(credits, [incomes[0]]).map((c) => c.key)).toEqual(["renda", "renda", "sem"]);
    expect(suggestionCredits(credits, [])).toHaveLength(5);
  });
  it("Duet is asked from the first closed month, at most a year back", () => {
    expect(duetFrom(["2026-08", "2026-09"], "2026-10")).toBe("2026-08");
    expect(duetFrom(["2026-08", "2026-09", "2026-12"], "2027-01")).toBe("2026-08");
    expect(duetFrom(["2024-01", "2024-02"], "2026-10")).toBe("2025-10");
    expect(duetFrom([], "2026-10")).toBe("2026-10");
  });
  it("months before what was asked of Duet show as unknown, not 0", () => {
    const h = { months: [{ month: "2026-08", bank: 100, duet: 0 }, { month: "2026-09", bank: 100, duet: 150 }], suggestion: 0, share: null };
    expect(withDuetRange(h, "2026-09").months.map((m) => m.duet)).toEqual([null, 150]);
    // Without Duet nothing changes.
    const none = { ...h, months: h.months.map((m) => ({ ...m, duet: null })) };
    expect(withDuetRange(none, "2026-09").months.map((m) => m.duet)).toEqual([null, null]);
  });
});

describe("the projection's first month: the rest of this one", () => {
  const people = [
    { id: "mj", display_name: "João", mesada_cents: 50000 },
    { id: "ma", display_name: "Joana", mesada_cents: 0 },
  ];
  const oct = [
    ...txs,
    t("2026-10-06", -7000, "DD EDP", "luz"),
    t("2026-10-08", 120000, "TRF CRED SEPA+ DE INQUILINO RENDA", "ren"),
    t("2026-10-15", -20000, "TRF P/ JOAO MANUEL SILVA", "pj"),
    t("2026-10-19", -1500, "APPLE PAY CONTINENTE", null, { source: "applepay" }),
  ];
  const real = monthBreakdown(oct, ctx, "2026-10");
  const sem = monthBreakdown(oct, ctx, "2026-10", { semPontuais: true });
  const rest = (over: Partial<Parameters<typeof currentMonthRest>[0]> = {}) =>
    currentMonthRest({
      balance: 400000,
      real,
      sem,
      categories,
      plan: normalizePlan({}),
      incomes,
      members: people,
      mesadaMonths: [],
      txs: oct,
      today: "2026-10-21",
      casa: 85000,
      ...over,
    });

  it("what is still to come in and to go out, as Este mês forecasts it", () => {
    const r = rest();
    // The salary (not in yet); the rent already came.
    expect(r.toCome).toEqual([{ label: "Ordenado (dia 8)", cents: 195157 }]);
    // The loan not paid yet, what is left of João's 500 €, the Apple Pay note.
    expect(r.toGo).toEqual([
      { label: "Contas fixas por pagar", cents: 85000 },
      { label: "Mesadas por sair", cents: 30000 },
      { label: "Apple Pay ainda por descontar", cents: 1500 },
    ]);
    expect(r.month).toBe("2026-10");
    expect(r.entra).toBe(195157);
    expect(r.sai).toBe(116500);
    expect(r.sobra).toBe(195157 - 116500);
    expect(r.saldoFim).toBe(400000 + 195157 - 116500);
    expect(r.baixo).toBe(false);
  });

  it("a month's own mesada (pinned) counts, and a low end is flagged", () => {
    const r = rest({ balance: 0, mesadaMonths: [{ member_id: "mj", month: "2026-10-01", amount_cents: 20000 }], casa: 200000 });
    expect(r.toGo.find((l) => l.label === "Mesadas por sair")).toBeUndefined();
    expect(r.saldoFim).toBe(195157 - 86500);
    expect(r.baixo).toBe(true);
  });
});
