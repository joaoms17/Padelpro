import { describe, it, expect } from "vitest";
import {
  balanceEnds,
  casaArrendada,
  compactEuros,
  compareRows,
  dayShort,
  duetShare,
  expectedByLine,
  howItCame,
  incomeTag,
  mesadaStatus,
  missingIncomes,
  monthChips,
  paraLabel,
} from "./meses";
import { monthBreakdown, referenceAverages, type EngineCtx, type EngineTx } from "./month";

const cat = (id: string, grp: string, name: string, system_role: string | null = null) =>
  ({ id, grp, name, system_role, archived: false, merged_into: null, sort: 0, budget_cents: null }) as EngineCtx["categories"][number];
const categories = [
  cat("ord", "entrada", "Ordenado João", "salario"),
  cat("rep", "entrada", "Despesas de representação", "representacao"),
  cat("ren", "entrada", "Renda casa arrendada", "renda"),
  cat("pre", "fixa", "Prestação casa"),
  cat("prea", "fixa", "Prestação casa arrendada"),
  cat("sup", "variavel", "Supermercado"),
  cat("res", "variavel", "Restaurantes e cafés"),
  cat("tra", "atividade", "Trabalho da Joana"),
  cat("pj", "mesada", "Para o João", "mesada"),
  cat("pa", "mesada", "Para a Joana", "mesada"),
];
const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const inc = (id: string, label: string, amount: number, match: string, kind: string | null, day: number, every = 1) =>
  ({ id, household_id: "h", label, amount_cents: amount, parts: 1, day, every_months: every, anchor_month: "2026-07-01", match_text: match, active: true, kind }) as EngineCtx["incomes"][number];
const incomes = [
  inc("i1", "Ordenado Joao", 195157, "ntt data", "salario", 23),
  inc("i2", "Despesas Joao", 54160, "despesas joao", "representacao", 10),
  inc("i3", "Renda Casa", 120000, "renda", "renda", 8),
];
const ctx: EngineCtx = { categories, members, incomes, today: "2026-10-21", firstDataDate: "2026-07-20" };

let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});

const txs: EngineTx[] = [
  // August: salary with a prémio, two months of representação, rent.
  t("2026-08-22", 764388, "Ordenado de Ntt Data Portugal s a", "ord"),
  t("2026-08-11", 54160, "TRF DESPESAS JOAO", "rep"),
  t("2026-08-12", 54160, "TRF DESPESAS JOAO", "rep"),
  t("2026-08-08", 120000, "TRF CRED SEPA+ DE INQUILINO RENDA", "ren"),
  t("2026-08-05", -85000, "PRESTACAO EMPRESTIMO 1", "pre"),
  t("2026-08-05", -62000, "PRESTACAO EMPRESTIMO 2", "prea"),
  t("2026-08-03", -40000, "COMPRA CONTINENTE", "sup"),
  t("2026-08-04", -5000, "REST O FAROL", "res"),
  t("2026-08-01", -50000, "TRF IMED P/ JOAO MANUEL SILVA", "pj"),
  t("2026-08-20", -9000, "COMPRA BRINDE", null, { pontual: true }),
  // September: salary only part, no rent, no representação.
  t("2026-09-22", 150000, "Ordenado de Ntt Data Portugal s a", "ord"),
  t("2026-09-05", -85000, "PRESTACAO EMPRESTIMO 1", "pre"),
  t("2026-09-03", -30000, "COMPRA CONTINENTE", "sup"),
  t("2026-09-09", -12000, "MATERIAL", "tra"),
  t("2026-09-01", -50000, "TRF IMED P/ JOAO MANUEL SILVA", "pj"),
  t("2026-09-27", -30000, "MB WAY P/ JOANA CARNEIRO", "pa"),
  t("2026-09-28", 5000, "MB WAY DE JOANA CARNEIRO", "pa"),
];
const aug = monthBreakdown(txs, ctx, "2026-08");
const sep = monthBreakdown(txs, ctx, "2026-09");
const augS = monthBreakdown(txs, ctx, "2026-08", { semPontuais: true });
const sepS = monthBreakdown(txs, ctx, "2026-09", { semPontuais: true });

describe("expected incomes", () => {
  it("groups what is due by income line", () => {
    const e = expectedByLine([...incomes, inc("i4", "Explicações", 20000, "explic", "outra", 15, 2)], "2026-08");
    expect(e.get("ordenado")?.cents).toBe(195157);
    expect(e.get("renda")?.day).toBe(8);
    // Every two months from July: not due in August.
    expect(e.has("outras")).toBe(false);
    expect(expectedByLine([...incomes, inc("i4", "Explicações", 20000, "explic", "outra", 15, 2)], "2026-09").get("outras")?.cents).toBe(20000);
  });

  it("guesses the kind from the label before migration 0015", () => {
    const e = expectedByLine([inc("x", "Renda do T2", 90000, "t2", null, 5)], "2026-09");
    expect(e.get("renda")?.cents).toBe(90000);
  });

  it("tags each line against what was expected", () => {
    expect(incomeTag("ordenado", 195157, 195157)).toEqual({ tone: "ok", text: "✓ como esperado" });
    expect(incomeTag("ordenado", 190000, 195157)?.tone).toBe("ok"); // ≥ 95 %
    expect(incomeTag("representacao", 108320, 54160)).toEqual({ tone: "info", text: "inclui meses em atraso" });
    const short = incomeTag("ordenado", 150000, 195157)!;
    expect(short.tone).toBe("warn");
    expect(short.text).toMatch(/^faltam 452\s€$/);
    expect(incomeTag("extra", 569231, 0)?.text).toBe("pontual");
    expect(incomeTag("sem", 1000, 0)?.text).toBe("por categorizar");
    expect(incomeTag("joana", 100000, 0)).toBeNull();
  });

  it("the engine's August lines tag as expected", () => {
    const exp = expectedByLine(incomes, "2026-08");
    const tag = (k: "ordenado" | "representacao" | "renda") => incomeTag(k, aug.entradas.find((l) => l.key === k)!.cents, exp.get(k)!.cents)?.text;
    expect(tag("ordenado")).toBe("✓ como esperado");
    expect(tag("representacao")).toBe("inclui meses em atraso");
    expect(tag("renda")).toBe("✓ como esperado");
  });

  it("says how the money came in", () => {
    expect(howItCame({ key: "ordenado", count: 1, days: [23] })).toBe("1 transferência · dia 23");
    expect(howItCame({ key: "representacao", count: 2, days: [12, 11] })).toBe("2 transferências · dias 11 e 12");
    expect(howItCame({ key: "extra", count: 1, days: [22] })).toBe("veio com o ordenado");
  });

  it("lists the expected incomes that did not arrive at all", () => {
    const miss = missingIncomes(sep.entradas, incomes, "2026-09");
    expect(miss.map((m) => m.label)).toEqual(["Despesas de representação", "Renda da casa arrendada"]);
    expect(miss[1]).toMatchObject({ cents: 120000, day: 8 });
    // The salary came (short): not "missing".
    expect(missingIncomes(aug.entradas, incomes, "2026-08")).toEqual([]);
    // "Outras" incomes are named one by one.
    const other = missingIncomes(sep.entradas, [inc("o1", "Explicações", 20000, "explic", "outra", 15)], "2026-09");
    expect(other).toEqual([{ key: "outras", label: "Explicações", cents: 20000, day: 15 }]);
  });
});

describe("month details", () => {
  it("the rented house: rent minus its mortgage", () => {
    expect(casaArrendada(aug)).toEqual({ renda: 120000, prestacao: 62000, saldo: 58000 });
    expect(casaArrendada(sep)).toBeNull();
  });

  it("chips: no partial first month, the current one 'até hoje'", () => {
    const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
    const real = new Map(months.map((m) => [m, { status: monthBreakdown(txs, ctx, m).status }]));
    expect(monthChips(months, real, "2026-10")).toEqual([
      { month: "2026-08", label: "Ago" },
      { month: "2026-09", label: "Set" },
      { month: "2026-10", label: "Out (até hoje)" },
    ]);
  });

  it("balance at both ends of the month", () => {
    const months = ["2026-08", "2026-09", "2026-10"];
    const eb = new Map([["2026-08", 300000], ["2026-09", 250000], ["2026-10", 410000]]);
    expect(balanceEnds(eb, months, "2026-09")).toEqual({ start: 300000, end: 250000 });
    expect(balanceEnds(eb, months, "2026-08")).toEqual({ start: null, end: 300000 });
    expect(balanceEnds(null, months, "2026-09")).toBeNull();
    expect(dayShort("2026-09", "first")).toBe("1 set");
    expect(dayShort("2026-09", "last")).toBe("30 set");
    expect(dayShort("2026-02", "last")).toBe("28 fev");
  });

  it("mesada taken and beyond it", () => {
    expect(mesadaStatus(60000, 60000)).toEqual({ dentro: 60000, alem: 0, completa: true });
    expect(mesadaStatus(60000, 75000)).toEqual({ dentro: 60000, alem: 15000, completa: true });
    expect(mesadaStatus(60000, 20000)).toEqual({ dentro: 20000, alem: 0, completa: false });
    expect(mesadaStatus(0, -500)).toEqual({ dentro: 0, alem: 0, completa: false });
  });

  it("names and Duet share", () => {
    expect(paraLabel("João")).toBe("Para o João");
    expect(paraLabel("Joana")).toBe("Para a Joana");
    expect(duetShare([{ amount_cents: 100000 }, { amount_cents: 50000 }], 120000)).toEqual({ duet: 150000, bank: 120000, share: 0.8 });
    expect(duetShare([], 50000).share).toBeNull();
  });
});

describe("compare table", () => {
  const averages = referenceAverages([augS, sepS]);
  const rows = compareRows([augS, sepS], [aug, sep], averages, members);
  const row = (k: string) => rows.find((r) => r.key === k)!;

  it("has the rows in order, one value per month", () => {
    expect(rows.map((r) => r.key)).toEqual([
      "entrou", "ordenado", "representacao", "renda", "joana",
      "fixas", "dia", "trabalho", "pessoa:mj", "pessoa:ma", "sem", "sobrou", "pontuais",
    ]);
    expect(row("ordenado").values).toEqual([195157, 150000]);
    expect(row("representacao").values).toEqual([108320, 0]);
    expect(row("fixas").values).toEqual([147000, 85000]);
    expect(row("pessoa:ma").values).toEqual([0, 25000]);
  });

  it("matches the engine's totals and averages", () => {
    expect(row("entrou").values).toEqual([augS.entrou, sepS.entrou]);
    expect(row("sobrou").values).toEqual([augS.sobrou, sepS.sobrou]);
    expect(row("dia").avg).toBe(averages.dia);
    expect(row("entrou").avg).toBe(Math.round((augS.entrou + sepS.entrou) / 2));
    expect(row("pessoa:mj").avg).toBe(50000);
  });

  it("opens the day-to-day into its categories, biggest average first", () => {
    const kids = row("dia").children!;
    expect(kids.map((k) => k.label)).toEqual(["Supermercado", "Restaurantes e cafés"]);
    expect(kids[0].values).toEqual([40000, 30000]);
    expect(kids[0].avg).toBe(35000);
    expect(row("fixas").children!.map((k) => k.label)).toEqual(["Prestação casa", "Prestação casa arrendada"]);
  });

  it("pontuais come from the real months (the prémio and one-off spending)", () => {
    expect(row("pontuais").avg).toBeNull();
    expect(row("pontuais").pair).toEqual([
      { inn: 764388 - 195157, out: 9000 },
      { inn: 0, out: 0 },
    ]);
  });

  it("compact amounts", () => {
    expect(compactEuros(123456)).toMatch(/^1\s?235$/);
    expect(compactEuros(-8500)).toBe("−85");
    expect(compactEuros(0)).toBe("0");
  });
});
