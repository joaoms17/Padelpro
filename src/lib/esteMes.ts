// Este mês: the small calculations behind the home screen — how fresh the
// bank data is, what is left to review, what of the expected incomes already
// arrived, the mesadas so far, the end-of-month forecast and the steps to the
// plan. The totals themselves come from the month and plan engines. Pure and
// testable.
import { isDueInMonth } from "./forecast";
import { inScope, incomeKind, type EngineIncome, type EngineTx, type IncomeKey, type IncomeKind, type MonthBreakdown } from "./month";
import type { MonthControl, PlanSettings, PlanTotals } from "./plan";
import { formatEuros, monthName } from "./format";
import type { Category, Member } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora mesmo" / "há 5 min" / "há 3 h" / "há 2 dias". */
export function sinceLabel(iso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - Date.parse(iso));
  if (ms < 2 * MINUTE) return "agora mesmo";
  if (ms < HOUR) return `há ${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `há ${Math.floor(ms / HOUR)} h`;
  const d = Math.floor(ms / DAY);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

export interface StatusNote {
  tone: "grey" | "amber" | "red";
  text: string;
  action?: { label: string; to: string };
}

/** The bank data's freshness and the bank consent, as short lines. */
export function bankNotes(lastSyncAt: string | null, consentUntil: string | null, nowMs: number): StatusNote[] {
  const out: StatusNote[] = [];
  if (!lastSyncAt) {
    out.push({ tone: "amber", text: "Banco ainda não ligado", action: { label: "Ligar", to: "/ligar-banco" } });
  } else if (nowMs - Date.parse(lastSyncAt) > 36 * HOUR) {
    out.push({ tone: "amber", text: `Banco sem atualizar ${sinceLabel(lastSyncAt, nowMs)}`, action: { label: "Atualizar", to: "/ligar-banco" } });
  } else {
    out.push({ tone: "grey", text: `Banco atualizado ${sinceLabel(lastSyncAt, nowMs)}` });
  }
  if (consentUntil) {
    const days = Math.ceil((Date.parse(consentUntil) - nowMs) / DAY);
    const renew = { label: "Renovar", to: "/ligar-banco" };
    if (days <= 0) out.push({ tone: "red", text: "A ligação ao Santander expirou", action: renew });
    else if (days <= 14) {
      out.push({
        tone: days <= 3 ? "red" : "amber",
        text: days === 1 ? "A ligação ao Santander expira amanhã" : `A ligação ao Santander expira em ${days} dias`,
        action: renew,
      });
    }
  }
  return out;
}

const SUGGESTED = new Set(["sugestao", "ai"]);

export interface ReviewCount {
  /** Without a category. */
  sem: number;
  /** Filed by a suggestion, to confirm. */
  validar: number;
  /** Where to go: this month's list, or every month's when some are elsewhere. */
  to: string;
}

/** What waits in Movimentos (Apple Pay notes aside), across every month. */
export function reviewCount(txs: Pick<EngineTx, "booking_date" | "category_id" | "category_source" | "source">[], month: string): ReviewCount {
  let sem = 0;
  let validar = 0;
  let semElsewhere = false;
  let validarElsewhere = false;
  for (const t of txs) {
    if (t.source === "applepay") continue;
    const other = t.booking_date.slice(0, 7) !== month;
    if (!t.category_id) {
      sem++;
      if (other) semElsewhere = true;
    } else if (t.category_source && SUGGESTED.has(t.category_source)) {
      validar++;
      if (other) validarElsewhere = true;
    }
  }
  const vista = sem > 0 ? "categorizar" : "validar";
  const elsewhere = sem > 0 ? semElsewhere : validarElsewhere;
  return { sem, validar, to: `/movimentos?vista=${vista}${elsewhere ? "&mes=todos" : ""}` };
}

/** Apple Pay notes the bank hasn't taken from the balance yet (they count as spent). */
export function applePayPending(txs: Pick<EngineTx, "booking_date" | "source" | "amount_cents">[], month: string, today: string): number {
  return txs
    .filter((t) => t.source === "applepay" && t.amount_cents < 0 && inScope(t, month, today))
    .reduce((a, t) => a - t.amount_cents, 0);
}

export interface IncomeGroup {
  kind: IncomeKind;
  label: string;
  /** The earliest usual day among its incomes. */
  day: number;
  expected: number;
  arrived: number;
  pending: number;
}

export interface IncomeProgress {
  groups: IncomeGroup[];
  expected: number;
  arrived: number;
  /** Groups with something still to come. */
  missing: IncomeGroup[];
}

const KIND_ORDER: IncomeKind[] = ["salario", "representacao", "renda", "outra"];
const KIND_LINE: Record<IncomeKind, IncomeKey> = { salario: "ordenado", representacao: "representacao", renda: "renda", outra: "outras" };
const KIND_LABEL: Record<Exclude<IncomeKind, "outra">, string> = { salario: "Ordenado", representacao: "Representação", renda: "Renda" };

/**
 * The incomes due this month against what the month's breakdown says came in
 * for each kind (salary, representação, renda, others). A kind has arrived
 * once (almost) all of it did, or once each of its transfers came in and the
 * total is close (a salary varies a little).
 */
export function incomeProgress(incomes: EngineIncome[], b: Pick<MonthBreakdown, "month" | "entradas">): IncomeProgress {
  const due = incomes.filter((i) => isDueInMonth(i, b.month));
  const groups: IncomeGroup[] = [];
  for (const kind of KIND_ORDER) {
    const list = due.filter((i) => incomeKind(i) === kind);
    if (list.length === 0) continue;
    const expected = list.reduce((a, i) => a + i.amount_cents, 0);
    const parts = list.reduce((a, i) => a + Math.max(1, i.parts), 0);
    const line = b.entradas.find((l) => l.key === KIND_LINE[kind]);
    const arrived = Math.max(0, line?.cents ?? 0);
    const done = arrived >= expected * 0.95 || ((line?.count ?? 0) >= parts && arrived >= expected * 0.7);
    groups.push({
      kind,
      label: kind === "outra" ? (list.length === 1 ? list[0].label : "Outras entradas") : KIND_LABEL[kind],
      day: Math.min(...list.map((i) => i.day)),
      expected,
      arrived,
      pending: done ? 0 : Math.max(0, expected - arrived),
    });
  }
  return {
    groups,
    expected: groups.reduce((a, g) => a + g.expected, 0),
    arrived: groups.reduce((a, g) => a + g.arrived, 0),
    missing: groups.filter((g) => g.pending > 0),
  };
}

export interface MesadaRow {
  memberId: string;
  name: string;
  /** This month's mesada. */
  mesada: number;
  /** What they took (net), one-offs aside. */
  levou: number;
  /** One-offs (marked "pontual") on top. */
  pontual: number;
  /** Above the mesada. */
  alem: number;
  /** What of the mesada is still to go. */
  porSair: number;
}

/** Each one's mesada against what they took this month. */
export function mesadaRows(
  members: Pick<Member, "id" | "display_name">[],
  semPontuais: Pick<MonthBreakdown, "pessoas">,
  real: Pick<MonthBreakdown, "pessoas">,
  mesadaOf: (memberId: string) => number,
): MesadaRow[] {
  const net = (b: Pick<MonthBreakdown, "pessoas">, id: string) => b.pessoas.find((p) => p.memberId === id)?.net ?? 0;
  return members.map((m) => {
    const mesada = Math.max(0, mesadaOf(m.id));
    const levou = net(semPontuais, m.id);
    return {
      memberId: m.id,
      name: m.display_name,
      mesada,
      levou,
      pontual: Math.max(0, net(real, m.id) - levou),
      alem: Math.max(0, levou - mesada),
      porSair: Math.max(0, mesada - levou),
    };
  });
}

export interface ForecastItem {
  label: string;
  cents: number;
}

/** What is still to come in and to go out until the end of the month. */
export function forecastParts(input: {
  control: Pick<MonthControl, "categorias" | "fixasPorPagar">;
  incomes: Pick<IncomeProgress, "missing">;
  /** Joana's plan value and what she put in so far (from the plan's first month); null before. */
  joana: { plan: number; arrived: number } | null;
  mesadas: Pick<MesadaRow, "porSair">[];
  applePay: number;
}): { toCome: ForecastItem[]; toGo: ForecastItem[] } {
  const toCome: ForecastItem[] = input.incomes.missing.map((g) => ({ label: `${g.label} (dia ${g.day})`, cents: g.pending }));
  if (input.joana) toCome.push({ label: "Joana (o que falta do plano)", cents: Math.max(0, input.joana.plan - input.joana.arrived) });
  const porSair = (grp: string) => input.control.categorias.filter((c) => c.grp === grp).reduce((a, c) => a + c.porSair, 0);
  const toGo: ForecastItem[] = [
    { label: "Contas fixas por pagar", cents: input.control.fixasPorPagar },
    { label: "Mesadas por sair", cents: input.mesadas.reduce((a, m) => a + m.porSair, 0) },
    { label: "Dia a dia até ao fim", cents: porSair("variavel") },
    { label: "Trabalho da Joana até ao fim", cents: porSair("atividade") },
    { label: "Apple Pay ainda por descontar", cents: input.applePay },
  ];
  return { toCome: toCome.filter((l) => l.cents > 0), toGo: toGo.filter((l) => l.cents > 0) };
}

/** "o João" / "a Joana". */
export function comArtigo(name: string): string {
  return `${/a$/i.test(name.trim()) ? "a" : "o"} ${name}`;
}

/** "agosto e setembro" / "de março a setembro". */
export function monthsLabel(months: string[]): string {
  const names = months.map(monthName);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `de ${names[0]} a ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export interface PrepStep {
  key: "categorizar" | "entradas" | "joana" | "fixas" | "dia" | "mesadas";
  label: string;
  done: boolean;
  sub: string;
  to: string;
}

/** The six things to decide before the plan's first month. */
export function prepSteps(input: {
  /** The closed months' breakdowns (real), oldest first. */
  closed: Pick<MonthBreakdown, "month" | "semCount" | "porValidar">[];
  incomes: EngineIncome[];
  plan: PlanSettings;
  categories: Pick<Category, "grp" | "budget_cents" | "archived">[];
  totals: Pick<PlanTotals, "R" | "J" | "F" | "V">;
  members: Pick<Member, "id" | "display_name">[];
}): PrepStep[] {
  const { closed, plan, totals } = input;
  const sem = closed.reduce((a, b) => a + b.semCount, 0);
  const validar = closed.reduce((a, b) => a + b.porValidar, 0);
  const first = closed.find((b) => b.semCount + b.porValidar > 0);
  const budgeted = (grp: string) => input.categories.some((c) => c.grp === grp && !c.archived && (c.budget_cents ?? 0) > 0);
  const hasMesadas = Object.keys(plan.mesadas).length > 0;
  const nIncomes = input.incomes.filter((i) => i.active).length;
  const pending = [sem > 0 && `${sem} por categorizar`, validar > 0 && `${validar} por confirmar`].filter(Boolean).join(" · ");
  const mesadas = input.members.map((m) => `${m.display_name} ${formatEuros(Math.max(0, plan.mesadas[m.id] ?? 0))}`).join(" · ");
  return [
    {
      key: "categorizar",
      label: closed.length ? `Categorizar ${monthsLabel(closed.map((b) => b.month))}` : "Categorizar os meses fechados",
      done: !first,
      sub: first ? `Faltam ${pending}` : "Tudo categorizado e confirmado",
      to: first ? `/movimentos?mes=${first.month}&vista=${first.semCount > 0 ? "categorizar" : "validar"}` : "/movimentos",
    },
    {
      key: "entradas",
      label: "O que entra todos os meses",
      done: input.incomes.length > 0,
      sub: input.incomes.length > 0 ? `${nIncomes} ${nIncomes === 1 ? "entrada" : "entradas"} · ${formatEuros(totals.R)}/mês` : "Ordenado, representação, renda",
      to: "/plano#entradas",
    },
    {
      key: "joana",
      label: "Quanto a Joana põe por mês",
      done: plan.joana_cents != null,
      sub: plan.joana_cents != null ? `${formatEuros(totals.J)}/mês` : "O que chega à conta, já líquido",
      to: "/plano#joana",
    },
    {
      key: "fixas",
      label: "Contas fixas",
      done: budgeted("fixa"),
      sub: budgeted("fixa") ? `${formatEuros(totals.F)}/mês` : "O valor previsto de cada conta",
      to: "/plano#fixas",
    },
    {
      key: "dia",
      label: "Limites do dia a dia",
      done: budgeted("variavel"),
      sub: budgeted("variavel") ? `${formatEuros(totals.V)}/mês` : "Um limite por categoria",
      to: "/plano#dia-a-dia",
    },
    {
      key: "mesadas",
      label: "Mesadas",
      done: plan.active || hasMesadas,
      sub: plan.active ? `Em vigor · ${mesadas}` : hasMesadas ? mesadas : "Quanto fica para cada um",
      to: "/plano#mesadas",
    },
  ];
}
