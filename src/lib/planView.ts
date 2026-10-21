// What the Plano screen shows around the plan engine (lib/plan.ts): the
// budget tables, the steps that are done, the reality checks and the
// checklist for the bank. Pure and testable.
import { plain } from "@shared/suggest";
import type { Credit } from "./forecast";
import { formatEuros, monthName, monthShort, parseCents } from "./format";
import {
  incomeKind,
  makeClassifier,
  type Averages,
  type EngineCtx,
  type EngineIncome,
  type EngineTx,
  type IncomeKey,
  type IncomeKind,
  type MonthBreakdown,
} from "./month";
import { monthlyEq, seedBudget, transitionDefaults, type PlanSettings, type PlanTotals } from "./plan";
import type { Category, Member } from "./types";

export const KIND_LABELS: Record<IncomeKind, string> = {
  salario: "Ordenado",
  representacao: "Despesas de representação",
  renda: "Renda",
  outra: "Outra",
};

/** "todos os meses" / "a cada 2 meses" / "uma vez por ano". */
export function freqText(every: number): string {
  const n = Math.max(1, Math.round(every));
  if (n === 1) return "todos os meses";
  if (n === 12) return "uma vez por ano";
  return `a cada ${n} meses`;
}

/** ["2026-08", "2026-09"] → "ago e set" (or "agosto e setembro"). */
export function monthsList(months: string[], long = false): string {
  const names = months.map((m) => (long ? monthName(m) : monthShort(m).toLowerCase()));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** An amount as typed in a euro field: "" / "850" / "12,50". */
export function centsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** A euro field's text: null when empty, "invalid" when it isn't a number. */
export function parseInput(text: string): number | null | "invalid" {
  if (!text.trim()) return null;
  const c = parseCents(text);
  if (c == null) return "invalid";
  return Math.max(0, c);
}

/** "1 234" (euros, no sign) for narrow table cells; 0 shows as "—". */
export function euroNum(cents: number): string {
  const e = Math.round(cents / 100);
  if (e === 0) return "—";
  return e.toLocaleString("pt-PT").replace("-", "−");
}

type BudgetCategory = Pick<Category, "id" | "grp" | "name" | "budget_cents" | "archived" | "sort">;

/** Categories with some limits changed on screen before the reload. */
export function applyBudgets<T extends Pick<Category, "id" | "budget_cents">>(
  categories: T[],
  overrides: Record<string, number | null>,
): T[] {
  if (Object.keys(overrides).length === 0) return categories;
  return categories.map((c) => (c.id in overrides ? { ...c, budget_cents: overrides[c.id] } : c));
}

export interface BudgetRow {
  id: string;
  name: string;
  grp: "fixa" | "variavel" | "atividade";
  /** Cost in each shown month (sem pontuais). */
  perMonth: Record<string, number>;
  /** Average of the reference months. */
  mean: number;
  budget: number | null;
}

/** One row per category of the groups, in the categories' order. */
export function budgetRows(
  categories: BudgetCategory[],
  grp: BudgetRow["grp"],
  months: string[],
  breakdowns: Map<string, MonthBreakdown>,
  averages: Pick<Averages, "categorias">,
): BudgetRow[] {
  return categories
    .filter((c) => c.grp === grp && !c.archived)
    .sort((a, b) => a.sort - b.sort)
    .map((c) => {
      const perMonth: Record<string, number> = {};
      for (const m of months) perMonth[m] = breakdowns.get(m)?.categorias.find((l) => l.categoryId === c.id)?.cents ?? 0;
      return {
        id: c.id,
        name: c.name,
        grp,
        perMonth,
        mean: averages.categorias.get(c.id)?.mean ?? 0,
        budget: c.budget_cents && c.budget_cents > 0 ? c.budget_cents : null,
      };
    });
}

/** "Usar as médias": up to the next 10 €, only for categories that cost something. */
export function seedFromMeans(rows: Pick<BudgetRow, "id" | "mean">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.mean > 0) out[r.id] = seedBudget(r.mean);
  return out;
}

/** What the categories that move to the mesadas cost on average. */
export function coveredMean(averages: Pick<Averages, "categorias">, covers: string[]): number {
  return covers.reduce((a, id) => a + Math.max(0, averages.categorias.get(id)?.mean ?? 0), 0);
}

/** The rented house on its own: the rent minus its loan, per month. */
export function casaArrendada(
  categories: BudgetCategory[],
  incomes: EngineIncome[],
  averages: Pick<Averages, "categorias" | "entradas">,
): { renda: number; prestacao: number; net: number } | null {
  const fromIncomes = incomes.filter((i) => i.active && incomeKind(i) === "renda").reduce((a, i) => a + monthlyEq(i), 0);
  const renda = fromIncomes > 0 ? fromIncomes : Math.max(0, averages.entradas.renda ?? 0);
  const cat = categories.find((c) => c.grp === "fixa" && !c.archived && plain(c.name).includes("arrendada"));
  if (!cat) return null;
  const prestacao = cat.budget_cents && cat.budget_cents > 0 ? cat.budget_cents : (averages.categorias.get(cat.id)?.mean ?? 0);
  if (renda <= 0 || prestacao <= 0) return null;
  return { renda, prestacao, net: renda - prestacao };
}

export interface StepsDone {
  entradas: boolean;
  joana: boolean;
  fixas: boolean;
  dia: boolean;
  poupanca: boolean;
  mesadas: boolean;
  /** Incomes, contas fixas and dia a dia are filled: the mesada can be worked out. */
  ready: boolean;
}

export function stepsDone(
  incomes: Pick<EngineIncome, "active">[],
  categories: Pick<Category, "grp" | "budget_cents" | "archived">[],
  plan: PlanSettings,
  memberIds: string[],
): StepsDone {
  const has = (grp: string) => categories.some((c) => c.grp === grp && !c.archived && (c.budget_cents ?? 0) > 0);
  const entradas = incomes.some((i) => i.active);
  const fixas = has("fixa");
  const dia = has("variavel");
  return {
    entradas,
    joana: plan.joana_cents != null,
    fixas,
    dia,
    poupanca: plan.savings_cents > 0,
    mesadas: plan.active || memberIds.some((id) => (plan.mesadas[id] ?? 0) > 0),
    ready: entradas && fixas && dia,
  };
}

/** The plan with November's defaults (João 500 €, Joana 0) when none were chosen. */
export function withDefaults(plan: PlanSettings, members: Pick<Member, "id" | "display_name">[]): PlanSettings {
  if (Object.keys(plan.transition).length > 0) return plan;
  return { ...plan, transition: transitionDefaults(members) };
}

/** The same mesada for everyone (null when they differ). */
export function commonMesada(plan: PlanSettings, memberIds: string[]): number | null {
  const vals = memberIds.map((id) => plan.mesadas[id] ?? 0);
  if (vals.length === 0) return null;
  return vals.every((v) => v === vals[0]) ? vals[0] : null;
}

export function setAllMesadas(plan: PlanSettings, memberIds: string[], cents: number): PlanSettings {
  const mesadas = { ...plan.mesadas };
  for (const id of memberIds) mesadas[id] = Math.max(0, cents);
  return { ...plan, mesadas };
}

/** Joana's Duet receipts, per month (cents). */
export function duetByMonth(receipts: { date: string; amount_cents: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of receipts) {
    const m = r.date.slice(0, 7);
    out[m] = (out[m] ?? 0) + r.amount_cents;
  }
  return out;
}

export type IncomeCredit = Credit & { key: IncomeKey };

/**
 * Money in that may be a regular income: not Joana's transfers, not one of
 * you giving money back, not savings, not refunds. `key` is its income line.
 */
export function incomeCredits(
  txs: EngineTx[],
  ctx: Pick<EngineCtx, "categories" | "members" | "incomes">,
  from: string,
): IncomeCredit[] {
  const classify = makeClassifier(ctx);
  const out: IncomeCredit[] = [];
  for (const t of txs) {
    if (t.amount_cents <= 0 || t.source === "applepay" || t.booking_date < from) continue;
    const k = classify(t);
    if (k.area !== "entrada" || k.key === "joana") continue;
    out.push({ id: t.id, booking_date: t.booking_date, amount_cents: t.amount_cents, description_raw: t.description_raw, key: k.key as IncomeKey });
  }
  return out;
}

const LINE_KIND: Partial<Record<IncomeKey, IncomeKind>> = { ordenado: "salario", representacao: "representacao", renda: "renda" };

/**
 * For "Encontrei no banco": leave out what an income already set up explains
 * (the salary filed as Ordenado, even under another keyword).
 */
export function suggestionCredits(
  credits: IncomeCredit[],
  incomes: Pick<EngineIncome, "active" | "kind" | "label">[],
): IncomeCredit[] {
  const kinds = new Set(incomes.filter((i) => i.active).map((i) => incomeKind(i)));
  return credits.filter((c) => {
    const kind = LINE_KIND[c.key];
    return !kind || !kinds.has(kind);
  });
}

const female = (name: string) => plain(name).endsWith("a");
/** "do João" / "da Joana". */
export const ofName = (name: string) => `${female(name) ? "da" : "do"} ${name}`;
/** "o João" / "a Joana". */
export const theName = (name: string) => `${female(name) ? "a" : "o"} ${name}`;

/** "o João passou para si em média 600 € e a Joana 0 €". */
export function peopleAverages(members: Pick<Member, "id" | "display_name">[], pessoas: Record<string, number>): string {
  const parts = members.map((m, i) => `${theName(m.display_name)}${i === 0 ? " passou para si em média" : ""} ${formatEuros(pessoas[m.id] ?? 0)}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** What to change in the bank's automatic transfers when the plan is put in place. */
export function mesadaChecklist(plan: PlanSettings, members: Pick<Member, "id" | "display_name">[]): string[] {
  const out: string[] = [];
  const day = plan.mesada_day;
  for (const m of members) {
    const mesada = Math.max(0, plan.mesadas[m.id] ?? 0);
    const before = Math.max(0, plan.transition[m.id] ?? 0);
    const who = ofName(m.display_name);
    if (before > 0 && mesada > 0 && before !== mesada) out.push(`Mudar a transferência automática ${who} de ${formatEuros(before)} para ${formatEuros(mesada)} (dia ${day})`);
    else if (before > 0 && mesada === before) out.push(`Manter a transferência automática ${who} de ${formatEuros(mesada)} (dia ${day})`);
    else if (before > 0 && mesada === 0) out.push(`Cancelar a transferência automática ${who} de ${formatEuros(before)}`);
    else if (mesada > 0) out.push(`Criar a transferência automática ${who} de ${formatEuros(mesada)} (dia ${day})`);
  }
  return out;
}

/** How many months of house costs the balance pays for (one decimal, down). */
export function monthsOfHouse(balance: number | null, casa: number): number | null {
  if (balance == null || casa <= 0) return null;
  return Math.max(0, Math.floor((balance / casa) * 10) / 10);
}

export function monthsText(n: number): string {
  return n === 1 ? "1 mês" : `${n.toLocaleString("pt-PT")} meses`;
}

export interface RealityCheck {
  months: string[];
  /** What the house cost on average (without what moves to the mesadas). */
  casaMedia: number;
  casaPlano: number;
  /** The plan counts at least what the house really cost. */
  ok: boolean;
}

export function realityCheck(
  averages: Pick<Averages, "months" | "casa" | "categorias">,
  totals: Pick<PlanTotals, "F" | "V" | "A">,
  covers: string[],
): RealityCheck | null {
  if (averages.months.length === 0) return null;
  const casaMedia = averages.casa - coveredMean(averages, covers);
  const casaPlano = totals.F + totals.V + totals.A;
  return { months: averages.months, casaMedia, casaPlano, ok: casaPlano >= casaMedia };
}

/** "Nov", "Dez", "Jan 2027" (the year when it changes). */
export function projMonthLabel(month: string): string {
  return month.endsWith("-01") ? `${monthShort(month)} ${month.slice(0, 4)}` : monthShort(month);
}

/** "2026-12" → "dezembro 2026". */
export const startLabel = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
