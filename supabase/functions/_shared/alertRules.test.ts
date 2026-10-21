import { describe, it, expect } from "vitest";
import {
  addDays,
  closeMessage,
  closeMetrics,
  consentMessage,
  monthAlerts,
  monthNamePt,
  pendingAlerts,
  planInForce,
  previousMonth,
  recordSent,
  weeklySummary,
  type Alert,
  type AlertData,
} from "./alertRules.ts";
import { monthBreakdown, type EngineCtx, type EngineTx } from "./engine/month.ts";
import { normalizePlan, planTotals } from "./engine/plan.ts";

const members = [
  { id: "mj", display_name: "João", mesada_cents: 60000 },
  { id: "ma", display_name: "Joana", mesada_cents: 60000 },
];
const c = (id: string, grp: string, name: string, budget: number | null, system_role: string | null = null) =>
  ({ id, grp, name, budget_cents: budget, archived: false, merged_into: null, sort: 0, system_role }) as EngineCtx["categories"][number];
const categories = [
  c("ord", "entrada", "Ordenado João", null, "salario"),
  c("ren", "entrada", "Renda casa arrendada", null, "renda"),
  c("eve", "entrada", "Eventos Joana", null, "eventos"),
  c("pre", "fixa", "Prestação casa", 150000),
  c("luz", "fixa", "Luz, água, gás e internet", 20000),
  c("imi", "fixa", "IMI e outras", 3000),
  c("sup", "variavel", "Supermercado", 60000),
  c("res", "variavel", "Restaurantes e cafés", 20000),
  c("rou", "variavel", "Casa e outras compras", 10000),
  c("tra", "atividade", "Trabalho da Joana", 10000),
  c("pj", "mesada", "Para o João", null, "mesada"),
  c("pa", "mesada", "Para a Joana", null, "mesada"),
];
const inc = (id: string, label: string, amount: number, match: string, kind: string, day: number) =>
  ({
    id, household_id: "h", label, amount_cents: amount, parts: 1, day, every_months: 1, anchor_month: "2026-07-01", match_text: match, active: true, kind,
  }) as EngineCtx["incomes"][number];
const incomes = [
  inc("i1", "Ordenado", 195157, "ntt data", "salario", 23),
  inc("i2", "Despesas de representação", 54160, "despesas joao", "representacao", 10),
  inc("i3", "Renda", 120000, "renda", "renda", 8),
];

let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});

// August to November: every income came; the prestação left in October and
// November, the luz only in November, the IMI never.
const history: EngineTx[] = [];
for (const m of ["2026-08", "2026-09", "2026-10", "2026-11"]) {
  history.push(t(`${m}-22`, 195157, "Ordenado de Ntt Data Portugal s a", "ord"));
  history.push(t(`${m}-10`, 54160, "TRF DESPESAS JOAO"));
  history.push(t(`${m}-08`, 120000, "TRF RENDA", "ren"));
}
history.push(t("2026-10-05", -150000, "PRESTACAO EMPRESTIMO", "pre"));
history.push(t("2026-11-05", -150000, "PRESTACAO EMPRESTIMO", "pre"));
history.push(t("2026-11-06", -6000, "DD EDP COMERCIAL", "luz"));

const december = [
  t("2026-12-02", -55000, "COMPRA CONTINENTE", "sup"),
  t("2026-12-05", -25000, "COMPRA RESTAURANTE", "res"),
  t("2026-12-01", -70000, "TRF P/ JOAO"),
  t("2026-12-10", 54160, "TRF DESPESAS JOAO"),
];

const plan = normalizePlan({ start_month: "2026-12", active: true, joana_cents: 100000, mesadas: { mj: 60000, ma: 60000 } });
const data = (today: string, txs: EngineTx[], over: Partial<AlertData> = {}): AlertData => ({
  txs,
  ctx: { categories, members, incomes, today, firstDataDate: "2026-07-20" },
  plan,
  members,
  mesadaMonths: [],
  ...over,
});

describe("monthAlerts", () => {
  const alerts = monthAlerts(data("2026-12-15", [...history, ...december]));
  const byKey = (k: string) => alerts.find((a) => a.key === k);

  it("only once the plan is in force (put in place, from its first month)", () => {
    expect(planInForce(plan, "2026-11")).toBe(false);
    expect(planInForce(plan, "2026-12")).toBe(true);
    expect(planInForce({ ...plan, active: false }, "2026-12")).toBe(false);
    expect(monthAlerts(data("2026-12-15", [...history, ...december], { plan: { ...plan, active: false } }))).toEqual([]);
    expect(monthAlerts(data("2026-11-25", history))).toEqual([]);
  });

  it("everything that deserves a push, most severe first", () => {
    expect(alerts.map((a) => `${a.key}:${a.level}`)).toEqual([
      "limite:res:over",
      "limite:sup:warn",
      "ritmo:warn",
      "mesada:mj:warn",
      "fixa:pre:info",
      "entrada:i3:info",
    ]);
  });

  it("limits at 80 % and 100 %, and the pace of the day to day", () => {
    expect(byKey("limite:sup")).toMatchObject({ pref: "limites", title: "Perto do limite", body: "Supermercado: 550 de 600 € (dia 15)." });
    expect(byKey("limite:res")).toMatchObject({ title: "Limite ultrapassado", body: "Restaurantes e cafés: 250 de 200 € (dia 15)." });
    // 800 € in 15 days → 1653 € in 31, against a 900 € plan.
    expect(byKey("ritmo")!.body).toBe("Ao ritmo de agora o dia a dia passa o plano em 753 €.");
  });

  it("a fixed cost that leaves every month and has not yet (yearly ones never count as late)", () => {
    expect(byKey("fixa:pre")).toMatchObject({ pref: "contas_fixas", body: "Prestação casa ainda não saiu este mês (previsto 1500 €)." });
    expect(byKey("fixa:luz")).toBeUndefined(); // only left in November
    expect(byKey("fixa:imi")).toBeUndefined();
    expect(monthAlerts(data("2026-12-10", [...history, ...december])).some((a) => a.key.startsWith("fixa:"))).toBe(false);
  });

  it("an income still missing a week after its day", () => {
    expect(byKey("entrada:i3")).toMatchObject({ pref: "entradas", body: "Renda ainda não entrou (costuma ser dia 8)." });
    expect(monthAlerts(data("2026-12-14", [...history, ...december])).some((a) => a.key === "entrada:i3")).toBe(false);
    const paid = monthAlerts(data("2026-12-15", [...history, ...december, t("2026-12-09", 120000, "TRF RENDA", "ren")]));
    expect(paid.some((a) => a.key.startsWith("entrada:"))).toBe(false);
  });

  it("a mesada passed (the month's own value wins over the base)", () => {
    expect(byKey("mesada:mj")).toMatchObject({ pref: "mesadas", body: "João já levou 700 € este mês (combinado 600 €)." });
    const more = monthAlerts(data("2026-12-15", [...history, ...december], { mesadaMonths: [{ member_id: "mj", month: "2026-12-01", amount_cents: 80000 }] }));
    expect(more.some((a) => a.key === "mesada:mj")).toBe(false);
  });

  it("Joana's money still to arrive, in the last days of the month", () => {
    const joana = t("2026-12-20", 60000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672");
    const late = monthAlerts(data("2026-12-29", [...history, ...december, joana]));
    expect(late.find((a) => a.key === "joana")).toMatchObject({ pref: "joana", body: "Faltam 400 € da Duet chegarem ao Santander (combinado 1000 €)." });
    expect(monthAlerts(data("2026-12-28", [...history, ...december, joana])).some((a) => a.key === "joana")).toBe(false);
    const all = t("2026-12-21", 40000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672");
    expect(monthAlerts(data("2026-12-29", [...history, ...december, joana, all])).some((a) => a.key === "joana")).toBe(false);
  });
});

describe("once per item, level and month", () => {
  const a = (key: string, level: Alert["level"]): Alert => ({ key, level, pref: "limites", title: "", body: "", url: "/" });
  const alerts = [a("limite:res", "over"), a("limite:sup", "warn"), a("ritmo", "warn"), a("mesada:mj", "warn"), a("fixa:pre", "info"), a("entrada:i3", "info")];
  const sent = { "2026-10": ["x:info"], "2026-11": ["limite:sup:warn"], "2026-12": ["limite:sup:warn", "limite:res:warn"] };

  it("skips what was already sent this month, at most a few a day", () => {
    expect(pendingAlerts(alerts, sent, "2026-12").map((x) => x.key)).toEqual(["limite:res", "ritmo", "mesada:mj", "fixa:pre"]);
    expect(pendingAlerts(alerts, sent, "2026-12", 10)).toHaveLength(5);
    expect(pendingAlerts(alerts, {}, "2027-01", 10)).toHaveLength(6);
  });

  it("records the month's ids and drops older months", () => {
    const next = recordSent(sent, "2026-12", [a("limite:res", "over"), a("limite:sup", "warn")]);
    expect(next).toEqual({ "2026-11": ["limite:sup:warn"], "2026-12": ["limite:sup:warn", "limite:res:warn", "limite:res:over"] });
    expect(recordSent({}, "2027-01", [a("ritmo", "warn")])).toEqual({ "2027-01": ["ritmo:warn"] });
  });
});

describe("consentMessage", () => {
  const now = Date.parse("2026-12-01T08:30:00Z");
  it("on 14 and 3 days before, and on the day itself", () => {
    expect(consentMessage("2026-12-15T10:00:00Z", now)).toEqual({ title: "Ligação ao banco", body: "A ligação ao Santander expira em 14 dias.", url: "/ligar-banco" });
    expect(consentMessage("2026-12-04T10:00:00Z", now)!.body).toBe("A ligação ao Santander expira em 3 dias.");
    expect(consentMessage("2026-12-01T20:00:00Z", now)!.body).toBe("A ligação ao Santander expira hoje.");
    expect(consentMessage("2026-12-06T10:00:00Z", now)).toBeNull();
    expect(consentMessage(null, now)).toBeNull();
  });
});

describe("weeklySummary", () => {
  const rows = [
    t("2026-12-06", -1000, "COMPRA PINGO DOCE", "sup"), // last week
    t("2026-12-07", -20000, "COMPRA CONTINENTE", "sup"),
    t("2026-12-10", -5000, "COMPRA RESTAURANTE", "res"),
    t("2026-12-11", 1500, "DEVOLUCAO CONTINENTE", "sup"),
    t("2026-12-12", -150000, "PRESTACAO EMPRESTIMO", "pre"), // not dia a dia
    t("2026-12-13", -3000, "Apple Pay Café", "res", { source: "applepay" }), // not booked yet
  ];
  const ctx: EngineCtx = { categories, members, incomes, today: "2026-12-13", firstDataDate: "2026-07-20" };

  it("what went on the dia a dia in the last 7 days, and what is left of the month's limit", () => {
    const s = weeklySummary(rows, ctx, plan);
    expect(s.spentCents).toBe(20000 + 5000 - 1500 + 3000);
    expect(s.leftCents).toBe(90000 - 27500);
    expect(s.body).toBe("Esta semana gastaram 265 € no dia a dia. Ainda podem gastar 625 € até dia 31.");
  });

  it("without limits, only what was spent; over the limit, by how much", () => {
    const noLimits = { ...ctx, categories: categories.map((x) => ({ ...x, budget_cents: null })) };
    expect(weeklySummary(rows, noLimits, plan).body).toBe("Esta semana gastaram 265 € no dia a dia.");
    const over = weeklySummary([...rows, t("2026-12-12", -70000, "COMPRA IKEA", "rou")], ctx, plan);
    expect(over.body).toBe("Esta semana gastaram 965 € no dia a dia. O dia a dia já passou o limite do mês em 75 €.");
  });

  it("a week across two months", () => {
    const s = weeklySummary([t("2026-11-28", -4000, "COMPRA CONTINENTE", "sup"), t("2026-12-02", -1000, "COMPRA CONTINENTE", "sup")], { ...ctx, today: "2026-12-03" }, plan);
    expect(s.spentCents).toBe(5000);
    expect(s.leftCents).toBe(90000 - 1000);
  });
});

describe("month close", () => {
  it("the push text and where it opens", () => {
    expect(closeMessage({ month: "2026-09", sobrou: 84000, semCount: 3 })).toEqual({
      title: "Fecho do mês",
      body: "Setembro fechou: sobraram 840 €. 3 movimentos sem categoria.",
      url: "/meses/2026-09",
    });
    expect(closeMessage({ month: "2026-11", sobrou: -12049, semCount: 1 }).body).toBe("Novembro fechou: faltaram 120 €. 1 movimento sem categoria.");
    expect(closeMessage({ month: "2026-12", sobrou: 0, semCount: 0 }).body).toBe("Dezembro fechou: sobraram 0 €.");
  });

  it("the snapshot keeps the engine's totals and the plan's", () => {
    const ctx: EngineCtx = { categories, members, incomes, today: "2026-12-01", firstDataDate: "2026-07-20" };
    const b = monthBreakdown(history, ctx, "2026-11");
    const totals = planTotals(incomes, categories, plan, ["mj", "ma"]);
    const m = closeMetrics(b, totals, 250000);
    expect(m).toMatchObject({ version: 2, status: "completo", entrou: 369317, fixas: 156000, casa: 156000, sobrou: 369317 - 156000, semCount: 0, saldoFim: 250000 });
    expect(m.plano).toMatchObject({ R: 369317, J: 100000, F: 173000, V: 90000, A: 10000, mesadasTotal: 120000 });
    expect(closeMetrics(b, null, null)).toMatchObject({ plano: null, saldoFim: null });
  });

  it("month names and dates", () => {
    expect(monthNamePt("2026-03")).toBe("Março");
    expect(previousMonth("2027-01-01")).toBe("2026-12");
    expect(addDays("2026-12-03", -6)).toBe("2026-11-27");
  });
});
