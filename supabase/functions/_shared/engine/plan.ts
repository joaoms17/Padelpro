// The couple's plan: what comes in every month, what the house costs, what
// to save, and so how much each mesada can be. Also "Com o modelo" (a month
// redone as if the plan were already in place) and the current month's
// control. Pure and testable.
import { addMonth, isDueInMonth } from "./forecast.ts";
import { budgetLevel, daysInMonth, paceProjection, type BudgetLevel } from "./budget.ts";
import { incomeKind, JOANA_FROM, type EngineIncome, type MonthBreakdown } from "./month.ts";
import { plain } from "../suggest.ts";
import type { Category, Member } from "./types.ts";

export type ExtrasRule = "poupanca" | "metade" | "decidir";

export interface PlanSettings {
  /** First month of the real model (YYYY-MM). */
  start_month: string;
  /** What Joana puts in the account per month (already net); null = not set. */
  joana_cents: number | null;
  /** What to save per month. */
  savings_cents: number;
  extras_rule: ExtrasRule;
  /** Agreed mesada per member id (cents). */
  mesadas: Record<string, number>;
  mesada_day: number;
  /** Mesadas in the transition month(s) before the start (João keeps his automatic 500 €). */
  transition: Record<string, number>;
  /** Day-to-day categories that become each one's own (paid from the mesada). */
  mesada_covers: string[];
  /** The plan was put in place ("Pôr em vigor"). */
  active: boolean;
}

export const DEFAULT_PLAN: PlanSettings = {
  start_month: "2026-12",
  joana_cents: null,
  savings_cents: 0,
  extras_rule: "metade",
  mesadas: {},
  mesada_day: 1,
  transition: {},
  mesada_covers: [],
  active: false,
};

/** A stored plan (possibly partial or older) with every field filled in. */
export function normalizePlan(raw: Partial<PlanSettings> | null | undefined): PlanSettings {
  const p = { ...DEFAULT_PLAN, ...(raw ?? {}) };
  return {
    ...p,
    mesadas: { ...(raw?.mesadas ?? {}) },
    transition: { ...(raw?.transition ?? {}) },
    mesada_covers: [...(raw?.mesada_covers ?? [])],
  };
}

/** November: João keeps his automatic 500 €, Joana has no mesada yet. */
export function transitionDefaults(members: Pick<Member, "id" | "display_name">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of members) out[m.id] = plain(m.display_name) === "joao" ? 50000 : 0;
  return out;
}

/** An income's monthly value (2 000 € every 2 months = 1 000 €/month). */
export const monthlyEq = (i: Pick<EngineIncome, "amount_cents" | "every_months">) =>
  Math.round(i.amount_cents / Math.max(1, i.every_months));

type BudgetCategory = Pick<Category, "id" | "grp" | "budget_cents" | "archived">;

const budgetSum = (categories: BudgetCategory[], grp: string, skip: string[] = []) =>
  categories
    .filter((c) => c.grp === grp && !c.archived && !skip.includes(c.id))
    .reduce((a, c) => a + Math.max(0, c.budget_cents ?? 0), 0);

export interface PlanTotals {
  /** Incomes set up (monthly value). */
  R: number;
  /** Joana per month: her average on Duet (she puts in everything she receives). */
  J: number;
  /** Contas fixas (their expected values). */
  F: number;
  /** Dia a dia limits (minus what becomes the mesadas'). */
  V: number;
  /** The limits of the dia a dia categories the mesadas pay (plan.mesada_covers). */
  C: number;
  /** Trabalho da Joana. */
  A: number;
  /** Savings. */
  P: number;
  /** What is left for the two mesadas. */
  D: number;
  /** Each one's mesada, rounded down to 10 €. */
  mesadaPossivel: number;
  mesadasTotal: number;
  /** D − the mesadas agreed (negative: the plan doesn't close). */
  folga: number;
  /** The same in a month Joana brings nothing (covered by savings). */
  folgaSemJoana: number;
}

/**
 * The plan's month. Joana puts in the account everything she receives on
 * Duet, so her part is not a value to set: `joanaCents` is her monthly
 * average there (see joanaHistory), 0 when unknown.
 */
export function planTotals(
  incomes: EngineIncome[],
  categories: BudgetCategory[],
  plan: PlanSettings,
  memberIds: string[],
  joanaCents = 0,
): PlanTotals {
  const R = incomes.filter((i) => i.active).reduce((a, i) => a + monthlyEq(i), 0);
  const J = Math.max(0, Math.round(joanaCents));
  const F = budgetSum(categories, "fixa");
  const V = budgetSum(categories, "variavel", plan.mesada_covers);
  const C = budgetSum(categories, "variavel") - V;
  const A = budgetSum(categories, "atividade");
  const P = Math.max(0, plan.savings_cents);
  const D = R + J - F - V - A - P;
  const mesadaPossivel = Math.floor(Math.max(0, D) / 2 / 1000) * 1000;
  const mesadasTotal = memberIds.reduce((a, id) => a + Math.max(0, plan.mesadas[id] ?? 0), 0);
  const folga = D - mesadasTotal;
  return { R, J, F, V, C, A, P, D, mesadaPossivel, mesadasTotal, folga, folgaSemJoana: folga - J };
}

/** A limit from an average: up to the next 10 €. */
export const seedBudget = (meanCents: number) => Math.max(0, Math.ceil(meanCents / 1000) * 1000);

export interface JoanaHistory {
  /** Each ended month: what she received on Duet and what reached the account. */
  months: { month: string; bank: number; duet: number | null }[];
  /** Her monthly average on Duet over the complete months (what the plan counts on). */
  average: number | null;
  /** Her weakest complete month on Duet. */
  weakest: number | null;
  /** How many months the average comes from. */
  count: number;
}

/**
 * Joana, month by month. She puts in the account everything she receives on
 * Duet, so her part of the plan is her Duet average over the complete months
 * known (`duetByMonth`, e.g. the last 12), and the risk is her weakest month.
 * Breakdowns give what reached the account in the months with bank data.
 */
export function joanaHistory(
  breakdowns: MonthBreakdown[],
  duetByMonth: Record<string, number> | null,
  currentMonth: string,
): JoanaHistory {
  const ended = breakdowns.filter((b) => b.status === "provisorio" || b.status === "completo");
  const bankOf = new Map(ended.map((b) => [b.month, b.entradas.find((l) => l.key === "joana")?.cents ?? 0]));
  const duetMonths = Object.keys(duetByMonth ?? {}).filter((m) => m < currentMonth);
  const monthsSet = new Set([...ended.map((b) => b.month), ...duetMonths]);
  const months = [...monthsSet].sort().map((month) => ({
    month,
    bank: bankOf.get(month) ?? 0,
    duet: duetByMonth ? (duetByMonth[month] ?? 0) : null,
  }));
  const values = duetMonths.map((m) => duetByMonth![m] ?? 0);
  const average = values.length ? Math.round(values.reduce((a, x) => a + x, 0) / values.length) : null;
  const weakest = values.length ? Math.min(...values) : null;
  return { months, average, weakest, count: values.length };
}

/** A person's mesada in a month under the plan (transition before the start). */
export function planMesada(plan: PlanSettings, memberId: string, month: string): number {
  if (month >= plan.start_month) return Math.max(0, plan.mesadas[memberId] ?? 0);
  if (month >= JOANA_FROM) return Math.max(0, plan.transition[memberId] ?? 0);
  return 0;
}

export interface ProjectionMonth {
  month: string;
  entra: number;
  sai: number;
  sobra: number;
  saldoFim: number;
  /** The balance ends below one month of house costs. */
  baixo: boolean;
}

/**
 * The next months under the plan, starting from where this month ends.
 * Before the plan's first month the house still pays the categories that
 * then pass to the mesadas (`C`): the transition mesadas don't cover them.
 */
export function projection(
  fromMonth: string,
  count: number,
  startBalance: number,
  incomes: EngineIncome[],
  totals: Pick<PlanTotals, "J" | "F" | "V" | "A"> & Partial<Pick<PlanTotals, "C">>,
  plan: PlanSettings,
  memberIds: string[],
  /** Joana in a month (e.g. what is already booked on Duet, or her average); default the average J. */
  joanaFor?: (month: string) => number,
): ProjectionMonth[] {
  const out: ProjectionMonth[] = [];
  let saldo = startBalance;
  for (let i = 1; i <= count; i++) {
    const month = addMonth(fromMonth, i);
    const entra =
      incomes.filter((x) => isDueInMonth(x, month)).reduce((a, x) => a + x.amount_cents, 0) +
      (month >= JOANA_FROM ? Math.max(0, joanaFor ? joanaFor(month) : totals.J) : 0);
    const mesadas = memberIds.reduce((a, id) => a + planMesada(plan, id, month), 0);
    const casa = totals.F + totals.V + totals.A + (month < plan.start_month ? Math.max(0, totals.C ?? 0) : 0);
    const sai = casa + mesadas;
    saldo += entra - sai;
    out.push({ month, entra, sai, sobra: entra - sai, saldoFim: saldo, baixo: saldo < casa });
  }
  return out;
}

export interface ModelMonth {
  month: string;
  entradas: { ordenado: number; representacao: number; renda: number; joana: number; outras: number };
  entrou: number;
  casa: number;
  semSaiu: number;
  mesadas: number;
  /** What would have been left with the plan's mesadas. */
  sobra: number;
  /** What really was left (sem pontuais). */
  sobrouReal: number;
  pessoas: { memberId: string; name: string; levou: number; modelo: number }[];
}

/**
 * A month redone with the plan: João's normal incomes (the salary without
 * prémio; representação and renda at their monthly value even when paid in
 * batches), everything Joana received on Duet (her real transfers when Duet
 * is unknown), the real house costs, and the plan's mesadas instead of what
 * each one took.
 * `b` is the month's breakdown sem pontuais.
 */
export function modelMonth(
  b: MonthBreakdown,
  incomes: EngineIncome[],
  plan: PlanSettings,
  members: Pick<Member, "id" | "display_name">[],
  /** What Joana received on Duet that month (she puts it all in); null = unknown, use what reached the account. */
  joanaDuet: number | null = null,
): ModelMonth {
  const line = (k: string) => b.entradas.find((l) => l.key === k)?.cents ?? 0;
  // Every income at its monthly value (2 400 € every 2 months = 1 200 € a month).
  const monthly = (kind: string) =>
    incomes.filter((i) => i.active && incomeKind(i) === kind).reduce((a, i) => a + monthlyEq(i), 0);
  const expected = (kind: string, real: number) => {
    const e = monthly(kind);
    return e > 0 ? e : real;
  };
  const entradas = {
    ordenado: expected("salario", line("ordenado")),
    representacao: expected("representacao", line("representacao")),
    renda: expected("renda", line("renda")),
    // With the model Joana puts in everything she receives on Duet.
    joana: joanaDuet != null ? Math.max(0, joanaDuet) : line("joana"),
    outras: line("outras") + line("sem"),
  };
  const entrou = Object.values(entradas).reduce((a, x) => a + x, 0);
  // What becomes each one's own (paid from the mesada) leaves the house.
  const covered = b.categorias.filter((c) => plan.mesada_covers.includes(c.categoryId)).reduce((a, c) => a + c.cents, 0);
  const casa = b.casa - covered;
  const mesada = (id: string) => Math.max(0, plan.mesadas[id] ?? 0);
  const pessoas = members.map((m) => ({
    memberId: m.id,
    name: m.display_name,
    levou: b.pessoas.find((p) => p.memberId === m.id)?.net ?? 0,
    modelo: mesada(m.id),
  }));
  const mesadas = pessoas.reduce((a, p) => a + p.modelo, 0);
  return {
    month: b.month,
    entradas,
    entrou,
    casa,
    semSaiu: b.semSaiu,
    mesadas,
    sobra: entrou - casa - b.semSaiu - mesadas,
    sobrouReal: b.sobrou,
    pessoas,
  };
}

// ── Current month ───────────────────────────────────────────────────────────

/** Within this of its expected value (or at 90 % of it), a fixed cost is paid. */
const FIXA_TOLERANCE = 1000;

/** A fixed cost charged at about its expected value is paid: nothing more to come. */
export function fixaPaid(charged: number, budget: number | null): boolean {
  if (!(charged > 0) || !budget || budget <= 0) return false;
  return budget - charged < FIXA_TOLERANCE || charged >= budget * 0.9;
}

export interface CategoryControl {
  categoryId: string;
  name: string;
  grp: "fixa" | "variavel" | "atividade";
  spent: number;
  budget: number | null;
  level: BudgetLevel;
  projected: number;
  /** What it may still cost this month (for the forecast). */
  porSair: number;
}

export interface MonthControl {
  month: string;
  day: number;
  daysLeft: number;
  /** Dia a dia: limit − spent (negative: over). */
  diaLeft: number;
  diaLimit: number;
  diaSpent: number;
  diaProjected: number;
  perDay: number;
  categorias: CategoryControl[];
  fixasPorPagar: number;
  fixasPendentes: { name: string; cents: number }[];
}

/** The current month against the limits. `b` is its breakdown so far. */
export function monthControl(
  b: MonthBreakdown,
  categories: Pick<Category, "id" | "grp" | "name" | "budget_cents" | "archived" | "sort">[],
  plan: PlanSettings,
  today: string,
): MonthControl {
  const month = b.month;
  const dim = daysInMonth(month);
  const day = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : dim;
  const spentOf = new Map(b.categorias.map((c) => [c.categoryId, c.cents]));
  // What was charged, before refunds: a refund doesn't make a bill bigger, nor
  // the month's pace faster.
  const chargedOf = new Map(b.categorias.map((c) => [c.categoryId, c.cents + c.refundCents]));
  const planOn = plan.active && month >= plan.start_month;
  const categorias: CategoryControl[] = categories
    .filter((c) => !c.archived && (c.grp === "fixa" || c.grp === "variavel" || c.grp === "atividade"))
    .sort((a, b2) => a.sort - b2.sort)
    .map((c) => {
      const spent = spentOf.get(c.id) ?? 0;
      const charged = chargedOf.get(c.id) ?? 0;
      const budget = c.budget_cents && c.budget_cents > 0 ? c.budget_cents : null;
      const covered = planOn && plan.mesada_covers.includes(c.id);
      const projected = paceProjection(spent, day, dim);
      const pace = paceProjection(charged, day, dim);
      // Fixed costs leave once, and a bill charged at about its expected
      // value is paid (budgets from the averages are rounded up to 10 €).
      // Day-to-day ones at the month's pace, but never less than what the
      // limit still allows (net of refunds, as "Ainda podem gastar" counts).
      const porSair =
        c.grp === "fixa"
          ? fixaPaid(charged, budget)
            ? 0
            : Math.max(0, (budget ?? 0) - charged)
          : covered
            ? 0
            : day < 7
              ? Math.max(0, (budget ?? 0) - spent)
              : Math.max(0, (budget ?? 0) - spent, pace - charged);
      return {
        categoryId: c.id,
        name: c.name,
        grp: c.grp as CategoryControl["grp"],
        spent,
        budget: covered ? 0 : budget,
        level: budgetLevel(spent, budget),
        projected,
        porSair,
      };
    });
  // What the mesadas pay (once the plan is on) is no longer the house's dia a dia.
  const dia = categorias.filter((c) => c.grp === "variavel" && !(planOn && plan.mesada_covers.includes(c.categoryId)));
  const diaLimit = dia.reduce((a, c) => a + (c.budget ?? 0), 0);
  const diaSpent = dia.reduce((a, c) => a + c.spent, 0);
  const daysLeft = Math.max(1, dim - day + 1);
  const fixas = categorias.filter((c) => c.grp === "fixa");
  return {
    month,
    day,
    daysLeft,
    diaLeft: diaLimit - diaSpent,
    diaLimit,
    diaSpent,
    diaProjected: paceProjection(diaSpent, day, dim),
    perDay: Math.floor(Math.max(0, diaLimit - diaSpent) / daysLeft),
    categorias,
    fixasPorPagar: fixas.reduce((a, c) => a + c.porSair, 0),
    fixasPendentes: fixas.filter((c) => c.porSair > 0).map((c) => ({ name: c.name, cents: c.porSair })),
  };
}

export interface Aviso {
  level: "info" | "warn" | "over";
  text: string;
}

/** What deserves attention this month, most severe first (max 3 on screen). */
export function avisos(
  control: MonthControl,
  b: MonthBreakdown,
  mesadaOf: (memberId: string) => number,
  missingIncomes: { label: string; day: number; cents: number }[],
): Aviso[] {
  const out: Aviso[] = [];
  for (const c of control.categorias) {
    if (c.grp === "fixa" || !c.budget) continue;
    if (c.level === "over") out.push({ level: "over", text: `${c.name}: ${euros(c.spent)} de ${euros(c.budget)} — passou o limite.` });
    else if (c.level === "warn") out.push({ level: "warn", text: `${c.name}: ${euros(c.spent)} de ${euros(c.budget)}.` });
  }
  if (control.day > 10 && control.diaLimit > 0 && control.diaProjected > control.diaLimit * 1.1) {
    out.push({ level: "warn", text: `Ao ritmo de agora o dia a dia passa o plano em ${euros(control.diaProjected - control.diaLimit)}.` });
  }
  for (const p of b.pessoas) {
    if (!p.memberId) continue;
    const m = mesadaOf(p.memberId);
    if (m > 0 && p.net > m) out.push({ level: "warn", text: `${p.name} já levou ${euros(p.net)} este mês (combinado ${euros(m)}).` });
  }
  for (const i of missingIncomes) {
    if (control.day >= i.day + 7) out.push({ level: "info", text: `${i.label} ainda não entrou (costuma ser dia ${i.day}).` });
  }
  const rank = { over: 0, warn: 1, info: 2 };
  return out.sort((a, b2) => rank[a.level] - rank[b2.level]);
}

const euros = (cents: number) => `${Math.round(cents / 100).toLocaleString("pt-PT")} €`;
