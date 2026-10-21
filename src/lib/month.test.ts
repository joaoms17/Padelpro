import { describe, it, expect } from "vitest";
import {
  eligible,
  inScope,
  makeClassifier,
  monthBreakdown,
  monthEndBalances,
  monthsBetween,
  paymentMethod,
  referenceAverages,
  todayLisbon,
  topMerchants,
  type EngineCtx,
  type EngineTx,
} from "./month";

const cat = (id: string, grp: string, name: string, system_role: string | null = null, extra: Record<string, unknown> = {}) =>
  ({ id, grp, name, system_role, archived: false, merged_into: null, sort: 0, budget_cents: null, ...extra }) as EngineCtx["categories"][number];

const categories = [
  cat("ord", "entrada", "Ordenado João", "salario"),
  cat("rep", "entrada", "Despesas de representação", "representacao"),
  cat("ren", "entrada", "Renda casa arrendada", "renda"),
  cat("eve", "entrada", "Eventos Joana", "eventos"),
  cat("out", "entrada", "Outras entradas"),
  cat("pre", "fixa", "Prestação casa"),
  cat("luz", "fixa", "Luz, água, gás e internet"),
  cat("sup", "variavel", "Supermercado"),
  cat("onl", "variavel", "Compras online"),
  cat("tra", "atividade", "Trabalho da Joana"),
  cat("pj", "mesada", "Para o João", "mesada"),
  cat("pa", "mesada", "Para a Joana", "mesada"),
  cat("pou", "interna", "Poupança"),
  cat("old", "variavel", "Prendas", null, { archived: true, merged_into: "sup" }),
];
const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const inc = (id: string, label: string, amount: number, match: string, kind: string, day = 23) => ({
  id, household_id: "h", label, amount_cents: amount, parts: 1, day, every_months: 1, anchor_month: "2026-07-01", match_text: match, active: true, kind,
}) as EngineCtx["incomes"][number];
const ctx: EngineCtx = {
  categories,
  members,
  incomes: [
    inc("i1", "Ordenado Joao", 195157, "ntt data", "salario"),
    inc("i2", "Despesas Joao", 54160, "despesas joao", "representacao", 10),
    inc("i3", "Renda Casa", 120000, "renda", "renda", 8),
  ],
  today: "2026-10-21",
  firstDataDate: "2026-07-20",
};

let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});

const aug = [
  t("2026-08-22", 764388, "Ordenado de Ntt Data Portugal s a", "ord"),
  t("2026-08-11", 54160, "TRF DESPESAS JOAO"),
  t("2026-08-12", 54160, "TRF DESPESAS JOAO"),
  t("2026-08-08", 120000, "TRF RENDA AGOSTO", "ren"),
  t("2026-08-20", 100000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672"),
  t("2026-08-01", -50000, "TRF P/ JOAO M SILVA"),
  t("2026-08-26", -569000, "TRF IMED P/ JOAO M SILVA", null, { pontual: true }),
  t("2026-08-05", -85000, "PRESTACAO EMPRESTIMO 123", "pre"),
  t("2026-08-06", -6000, "DD EDP COMERCIAL", "luz"),
  t("2026-08-09", -8450, "COMPRA CONTINENTE", "sup"),
  t("2026-08-15", -3000, "COMPRA FNAC", "old"), // merged into Supermercado
  t("2026-08-16", -5590, "Estrang Www Amazon Nk8yt9dq4", "onl"),
  t("2026-08-18", 1299, "DEVOLUCAO AMAZON", "onl"),
  t("2026-08-19", -12000, "COMPRA MATERIAL CABELEIREIRO", "tra"),
  t("2026-08-21", -10000, "TRF P/ CONTA POUPANCA", "pou"),
  t("2026-08-25", 5000, "TRF DE CONTA POUPANCA", "pou"),
  t("2026-08-27", -2000, "ESTORNO", "out"),
  t("2026-08-28", -4500, "COMPRA GALP AREIAS S JOAO"),
  t("2026-08-29", 2500, "TRF CRED DE ALGUEM"),
];

describe("makeClassifier", () => {
  const c = makeClassifier(ctx);
  it("keywords of an income beat a name in the description", () => {
    expect(c({ amount_cents: 54160, category_id: null, description_raw: "TRF DESPESAS JOAO" })).toMatchObject({ area: "entrada", key: "representacao" });
  });
  it("transfers naming one of you; shops with a name are not people", () => {
    expect(c({ amount_cents: -50000, category_id: null, description_raw: "TRF P/ JOAO M SILVA" })).toMatchObject({ area: "voces", memberId: "mj" });
    expect(c({ amount_cents: 20000, category_id: null, description_raw: "TRF DE JOAO M SILVA" })).toMatchObject({ area: "voces", memberId: "mj" });
    expect(c({ amount_cents: 100000, category_id: null, description_raw: "TRF CRED SEPA+ DE JOANA X" })).toMatchObject({ area: "entrada", key: "joana" });
    expect(c({ amount_cents: -4500, category_id: null, description_raw: "COMPRA GALP AREIAS S JOAO" })).toMatchObject({ area: "sem" });
  });
  it("follows merges; Poupança with a name is that person", () => {
    expect(c({ amount_cents: -100, category_id: "old", description_raw: null })).toMatchObject({ area: "dia", key: "sup" });
    expect(c({ amount_cents: -100, category_id: "pou", description_raw: "TRF P/ JOANA" })).toMatchObject({ area: "voces", memberId: "ma" });
    expect(c({ amount_cents: -100, category_id: "pou", description_raw: "TRF POUPANCA" })).toMatchObject({ area: "poupanca", key: "para" });
  });
});

describe("monthBreakdown — August", () => {
  const b = monthBreakdown(aug, ctx, "2026-08");
  const line = (k: string) => b.entradas.find((l) => l.key === k)!;
  it("splits the salary paid with the prémio", () => {
    expect(line("ordenado").cents).toBe(195157);
    expect(line("extra").cents).toBe(569231);
  });
  it("counts every income, with or without category", () => {
    expect(line("representacao")).toMatchObject({ cents: 108320, count: 2, days: [11, 12] });
    expect(line("renda").cents).toBe(120000);
    expect(line("joana")).toMatchObject({ cents: 100000, label: "Transferências da Joana" });
    expect(line("outras").cents).toBe(-2000); // money out in an income category corrects it
    expect(line("sem").cents).toBe(2500);
  });
  it("house: fixas, dia a dia (refunds netted, merges followed), trabalho", () => {
    expect(b.fixas).toBe(91000);
    expect(b.categorias.find((c) => c.categoryId === "sup")).toMatchObject({ cents: 11450, count: 2 });
    expect(b.categorias.find((c) => c.categoryId === "onl")).toMatchObject({ cents: 4291, refundCents: 1299 });
    expect(b.dia).toBe(15741);
    expect(b.trabalho).toBe(12000);
    expect(b.casa).toBe(91000 + 15741 + 12000);
  });
  it("each of you, savings, uncategorized", () => {
    expect(b.pessoas.find((p) => p.memberId === "mj")).toMatchObject({ levou: 619000, net: 619000 });
    expect(b.pessoas.find((p) => p.memberId === "ma")).toMatchObject({ levou: 0 });
    expect(b.poupancaPara).toBe(10000);
    expect(b.poupancaDe).toBe(5000);
    expect(b.semSaiu).toBe(4500);
    expect(b.semCount).toBe(2);
  });
  it("sobrou − savings moved = what the bank rows add up to", () => {
    const sum = aug.reduce((a, x) => a + x.amount_cents, 0);
    expect(b.sobrou - (b.poupancaPara - b.poupancaDe)).toBe(sum);
    expect(b.sobrou).toBe(b.entrou - b.casa - b.voces - b.semSaiu);
  });
  it("pontuais and the view without them", () => {
    expect(b.pontualIn).toBe(569231);
    expect(b.pontualOut).toBe(569000);
    const s = monthBreakdown(aug, ctx, "2026-08", { semPontuais: true });
    expect(s.entradas.find((l) => l.key === "extra")!.cents).toBe(0);
    expect(s.entradas.find((l) => l.key === "ordenado")!.cents).toBe(195157);
    expect(s.pessoas.find((p) => p.memberId === "mj")!.levou).toBe(50000);
  });
  it("biggest day-to-day spends and how money left", () => {
    expect(b.maiores[0]).toMatchObject({ cents: 12000 });
    expect(b.maiores.every((m) => m.cents > 0)).toBe(true);
    expect(b.metodo.debito_direto).toBe(6000);
    expect(b.metodo.transferencia).toBeGreaterThanOrEqual(619000);
  });
});

describe("status, scope and averages", () => {
  it("July is partial, October is running, September provisório until categorized", () => {
    expect(monthBreakdown([], ctx, "2026-07").status).toBe("parcial");
    expect(monthBreakdown([], ctx, "2026-10").status).toBe("a_decorrer");
    const sep = [t("2026-09-03", -1000, "SOMETHING")];
    expect(monthBreakdown(sep, ctx, "2026-09").status).toBe("provisorio");
    expect(monthBreakdown([t("2026-09-03", -1000, "X", "sup")], ctx, "2026-09").status).toBe("completo");
  });
  it("Apple Pay counts only while pending (≤ 5 days, this month)", () => {
    expect(inScope({ booking_date: "2026-10-19", source: "applepay" }, "2026-10", "2026-10-21")).toBe(true);
    expect(inScope({ booking_date: "2026-10-10", source: "applepay" }, "2026-10", "2026-10-21")).toBe(false);
    expect(inScope({ booking_date: "2026-09-30", source: "applepay" }, "2026-09", "2026-10-02")).toBe(false);
    const b = monthBreakdown([t("2026-10-19", -1500, "CAFE", "sup", { source: "applepay" })], ctx, "2026-10");
    expect(b).toMatchObject({ pendentes: 1, dia: 1500 });
  });
  it("eligible months feed the averages; otherwise provisório ones", () => {
    const a = monthBreakdown(aug, ctx, "2026-08", { semPontuais: true });
    const s = monthBreakdown([t("2026-09-09", -20000, "CONTINENTE", "sup")], ctx, "2026-09", { semPontuais: true });
    expect(eligible(s)).toBe(true);
    expect(eligible(a)).toBe(false); // 4 500 € without category > 2 %
    const avg = referenceAverages([a, s]);
    expect(avg).toMatchObject({ months: ["2026-09"], provisorio: false });
    expect(avg.categorias.get("sup")!.mean).toBe(20000);
    const prov = referenceAverages([a]);
    expect(prov.provisorio).toBe(true);
    expect(prov.categorias.get("sup")!.mean).toBe(11450);
  });
});

describe("review fixes", () => {
  it("Poupança chosen by hand stays savings even when the description names one of you", () => {
    const c = makeClassifier(ctx);
    expect(c({ amount_cents: -100000, category_id: "pou", description_raw: "TRF P/ JOAO M SILVA", category_source: "manual" })).toMatchObject({ area: "poupanca", key: "para" });
    expect(c({ amount_cents: -100000, category_id: "pou", description_raw: "TRF P/ JOAO M SILVA", category_source: "rule" })).toMatchObject({ area: "voces", memberId: "mj" });
  });
  it("an income keyword with an unusual amount is money in, not a person's", () => {
    const c = makeClassifier(ctx);
    expect(c({ amount_cents: 216640, category_id: null, description_raw: "TRF DESPESAS JOAO" })).toMatchObject({ area: "entrada", key: "sem" });
  });
  it("a salary marked pontual is split once, never dropped", () => {
    const rows = [t("2026-08-22", 764388, "Ordenado de Ntt Data Portugal s a", "ord", { pontual: true })];
    const real = monthBreakdown(rows, ctx, "2026-08");
    expect(real.entradas.find((l) => l.key === "ordenado")!.cents).toBe(195157);
    expect(real.entradas.find((l) => l.key === "extra")!.cents).toBe(569231);
    expect(real.pontualIn).toBe(569231);
    const sem = monthBreakdown(rows, ctx, "2026-08", { semPontuais: true });
    expect(sem.entrou).toBe(195157);
  });
  it("without an expected salary, the part marked pontual is the extra", () => {
    const noSalary = { ...ctx, incomes: ctx.incomes.filter((i) => i.id !== "i1") };
    const rows = [t("2026-08-22", 195157, "Ordenado", "ord"), t("2026-08-23", 500000, "Premio", "ord", { pontual: true })];
    const b = monthBreakdown(rows, noSalary, "2026-08");
    expect(b.entradas.find((l) => l.key === "ordenado")!.cents).toBe(195157);
    expect(b.entradas.find((l) => l.key === "extra")!.cents).toBe(500000);
    expect(b.pontualIn).toBe(500000);
    expect(monthBreakdown(rows, noSalary, "2026-08", { semPontuais: true }).entrou).toBe(195157);
  });
  it("an income without a kind is recognised by its name", () => {
    const unset = { ...ctx, incomes: ctx.incomes.map((i) => ({ ...i, kind: null })) };
    const b = monthBreakdown([t("2026-08-22", 764388, "Ordenado de Ntt Data Portugal s a")], unset, "2026-08");
    expect(b.entradas.find((l) => l.key === "ordenado")!.cents).toBe(195157);
  });
});

describe("helpers", () => {
  it("monthEndBalances walks back from today's balance (bank rows only)", () => {
    const rows = [t("2026-09-10", -1000, "A"), t("2026-10-05", 5000, "B"), t("2026-10-06", -700, "C", null, { source: "manual" })];
    const m = monthEndBalances(rows, 100000, ["2026-08", "2026-09", "2026-10"]);
    expect([m.get("2026-08"), m.get("2026-09"), m.get("2026-10")]).toEqual([96000, 95000, 100000]);
  });
  it("paymentMethod", () => {
    expect(paymentMethod("DD EDP COMERCIAL")).toBe("debito_direto");
    expect(paymentMethod("MB WAY P/ 9123")).toBe("mbway");
    expect(paymentMethod("TRF IMED P/ JOAO")).toBe("transferencia");
    expect(paymentMethod("COMPRA 1234 CONTINENTE")).toBe("cartao");
    expect(paymentMethod("LEVANTAMENTO ATM")).toBe("levantamento");
  });
  it("monthsBetween, topMerchants, todayLisbon", () => {
    expect(monthsBetween("2026-11-03", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    const rows = [t("2026-08-01", -1000, "COMPRA CONTINENTE 1"), t("2026-08-02", -500, "COMPRA CONTINENTE 2"), t("2026-08-03", -900, "LIDL")];
    expect(topMerchants(rows, rows.map((r) => r.id))[0]).toMatchObject({ cents: 1500, count: 2 });
    expect(todayLisbon(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-21");
  });
});
