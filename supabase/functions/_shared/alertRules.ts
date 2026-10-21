// What the server pushes, decided from the month engine — pure and testable.
// The Edge Functions (alerts, notify, monthly-close) load the data, call
// these and send. Texts are PT-PT; amounts are rounded to the euro.
import {
  inScope,
  makeClassifier,
  monthBreakdown,
  monthsBetween,
  type EngineCtx,
  type EngineTx,
  type MonthBreakdown,
} from "./engine/month.ts";
import { monthControl, type PlanSettings, type PlanTotals } from "./engine/plan.ts";
import { incomeMonths } from "./engine/conferir.ts";
import { mesadaFor, type MesadaMonth } from "./engine/mesadas.ts";
import { addMonth } from "./engine/forecast.ts";
import { daysInMonth } from "./engine/budget.ts";
import type { Member } from "./engine/types.ts";

/** The member's notification preference each alert obeys (members.notify_prefs). */
export type AlertPref = "limites" | "contas_fixas" | "entradas" | "mesadas" | "joana";
export type AlertLevel = "info" | "warn" | "over";

export interface Alert {
  /** What it is about, stable within a month ("limite:<category>", "ritmo"…). */
  key: string;
  level: AlertLevel;
  pref: AlertPref;
  title: string;
  body: string;
  url: string;
}

/** Alerts already sent, per month (YYYY-MM): "key:level" ids. Kept in settings.alerts_sent. */
export type AlertsSent = Record<string, string[]>;

export interface AlertData {
  txs: EngineTx[];
  /** `today` is the Lisbon date. */
  ctx: EngineCtx;
  plan: PlanSettings;
  members: Pick<Member, "id" | "display_name" | "mesada_cents">[];
  mesadaMonths: MesadaMonth[];
}

/** Whole euros, as the app shows them ("1250", "12 500"). */
const eur = (cents: number) => Math.round(cents / 100).toLocaleString("pt-PT");

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const monthNamePt = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

/** The month before today's (YYYY-MM). */
export const previousMonth = (today: string) => addMonth(today.slice(0, 7), -1);

/** An ISO date moved by whole days. */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** The plan's alerts only run once it was put in place, from its first month. */
export function planInForce(plan: Pick<PlanSettings, "active" | "start_month">, month: string): boolean {
  return plan.active === true && month >= plan.start_month;
}

const RANK: Record<AlertLevel, number> = { over: 0, warn: 1, info: 2 };

/**
 * What deserves a push this month (today's month), most severe first: day to
 * day limits at 80 % and 100 %, the pace of the day to day, fixed costs that
 * usually leave every month and have not yet (after day 10), expected incomes
 * still missing a week after their day, a mesada passed, and Joana's money
 * still to arrive in the last days of the month. Nothing before the plan is
 * in force.
 */
export function monthAlerts(d: AlertData): Alert[] {
  const today = d.ctx.today;
  const month = today.slice(0, 7);
  if (!planInForce(d.plan, month)) return [];
  const b = monthBreakdown(d.txs, d.ctx, month);
  const control = monthControl(b, d.ctx.categories, d.plan, today);
  const day = control.day;
  const dim = daysInMonth(month);
  const out: Alert[] = [];

  // Limits (dia a dia and trabalho; contas fixas have expected values, not limits).
  for (const c of control.categorias) {
    if (c.grp === "fixa" || !c.budget || c.level === "ok") continue;
    out.push({
      key: `limite:${c.categoryId}`,
      level: c.level,
      pref: "limites",
      title: c.level === "over" ? "Limite ultrapassado" : "Perto do limite",
      body: `${c.name}: ${eur(c.spent)} de ${eur(c.budget)} € (dia ${day}).`,
      url: "/",
    });
  }

  if (day > 10 && control.diaLimit > 0 && control.diaProjected > control.diaLimit * 1.1) {
    out.push({
      key: "ritmo",
      level: "warn",
      pref: "limites",
      title: "Dia a dia",
      body: `Ao ritmo de agora o dia a dia passa o plano em ${eur(control.diaProjected - control.diaLimit)} €.`,
      url: "/",
    });
  }

  // Fixed costs with an expected value that left in each of the two months
  // before (so a yearly IMI or insurance never counts as late) and not yet.
  if (day > 10) {
    const paidIn = (m: string) =>
      new Set(monthBreakdown(d.txs, d.ctx, m).categorias.filter((c) => c.area === "fixa" && c.cents > 0).map((c) => c.categoryId));
    const before = [paidIn(addMonth(month, -1)), paidIn(addMonth(month, -2))];
    for (const c of control.categorias) {
      if (c.grp !== "fixa" || !c.budget || c.spent > 0) continue;
      if (!before.every((s) => s.has(c.categoryId))) continue;
      out.push({
        key: `fixa:${c.categoryId}`,
        level: "info",
        pref: "contas_fixas",
        title: "Contas fixas",
        body: `${c.name} ainda não saiu este mês (previsto ${eur(c.budget)} €).`,
        url: "/",
      });
    }
  }

  // Expected incomes, as the app checks them (transfers pooled over the months).
  const first = d.ctx.firstDataDate;
  const credits = d.txs
    .filter((t) => t.amount_cents > 0 && t.source !== "applepay")
    .map((t) => ({ id: t.id, booking_date: t.booking_date, amount_cents: t.amount_cents, description_raw: t.description_raw }));
  const byIncome = incomeMonths(d.ctx.incomes, credits, first ? monthsBetween(first, month) : [month], today, first ?? undefined);
  for (const inc of d.ctx.incomes) {
    const m = byIncome.get(inc.id)?.find((x) => x.month === month);
    if (!m || !m.due || m.noData || m.missingCents < 100) continue;
    if (day < Math.min(inc.day + 7, dim)) continue;
    out.push({
      key: `entrada:${inc.id}`,
      level: "info",
      pref: "entradas",
      title: "Entradas",
      body:
        m.receivedCents > 0
          ? `${inc.label}: ainda faltam ${eur(m.missingCents)} € (costuma ser dia ${inc.day}).`
          : `${inc.label} ainda não entrou (costuma ser dia ${inc.day}).`,
      url: "/",
    });
  }

  for (const p of b.pessoas) {
    const m = p.memberId ? d.members.find((x) => x.id === p.memberId) : undefined;
    if (!m) continue;
    const agreed = mesadaFor(m, month, d.mesadaMonths);
    if (agreed > 0 && p.net > agreed) {
      out.push({
        key: `mesada:${m.id}`,
        level: "warn",
        pref: "mesadas",
        title: "Mesadas",
        body: `${p.name} já levou ${eur(p.net)} € este mês (combinado ${eur(agreed)} €).`,
        url: "/",
      });
    }
  }

  // Joana: what she agreed to put in the account (J), in the last 3 days.
  const J = Math.max(0, d.plan.joana_cents ?? 0);
  if (J > 0 && day >= dim - 2) {
    const gap = J - (b.entradas.find((l) => l.key === "joana")?.cents ?? 0);
    if (gap >= 100) {
      out.push({
        key: "joana",
        level: "info",
        pref: "joana",
        title: "Joana",
        body: `Faltam ${eur(gap)} € da Duet chegarem ao Santander (combinado ${eur(J)} €).`,
        url: "/",
      });
    }
  }

  return out.map((a, i) => ({ a, i })).sort((x, y) => RANK[x.a.level] - RANK[y.a.level] || x.i - y.i).map((x) => x.a);
}

export const alertId = (a: Pick<Alert, "key" | "level">) => `${a.key}:${a.level}`;

/** The alerts not sent yet this month (once per item and level), at most `max` a day. */
export function pendingAlerts(alerts: Alert[], sent: AlertsSent, month: string, max = 4): Alert[] {
  const done = new Set(sent[month] ?? []);
  return alerts.filter((a) => !done.has(alertId(a))).slice(0, max);
}

/** `sent` with these alerts recorded for the month; older months are dropped. */
export function recordSent(sent: AlertsSent, month: string, alerts: Alert[]): AlertsSent {
  const keep = addMonth(month, -1);
  const out: AlertsSent = {};
  for (const [m, ids] of Object.entries(sent)) if (m >= keep && m !== month && Array.isArray(ids)) out[m] = ids;
  out[month] = [...new Set([...(sent[month] ?? []), ...alerts.map(alertId)])];
  return out;
}

/** The bank consent push, on the days that matter (14 and 3 days before, and the day itself). */
export function consentMessage(validUntil: string | null | undefined, nowMs: number): { title: string; body: string; url: string } | null {
  const until = validUntil ? Date.parse(validUntil) : NaN;
  if (!Number.isFinite(until)) return null;
  const days = Math.floor((until - nowMs) / 86400000);
  if (days !== 14 && days !== 3 && days !== 0) return null;
  return {
    title: "Ligação ao banco",
    body: days === 0 ? "A ligação ao Santander expira hoje." : `A ligação ao Santander expira em ${days} dias.`,
    url: "/ligar-banco",
  };
}

// ── Weekly summary (Sunday) ─────────────────────────────────────────────────

export interface WeeklySummary {
  /** Day to day spent in the last 7 days (today included). */
  spentCents: number;
  /** Day to day still within the limit this month (null: no limits set). */
  leftCents: number | null;
  body: string;
}

export function weeklySummary(txs: EngineTx[], ctx: EngineCtx, plan: PlanSettings): WeeklySummary {
  const today = ctx.today;
  const from = addDays(today, -6);
  const classify = makeClassifier(ctx);
  let spentCents = 0;
  for (const t of txs) {
    const date = t.booking_date.slice(0, 10);
    if (date < from || date > today || !inScope(t, date.slice(0, 7), today)) continue;
    if (classify(t).area === "dia") spentCents -= t.amount_cents;
  }
  const month = today.slice(0, 7);
  const control = monthControl(monthBreakdown(txs, ctx, month), ctx.categories, plan, today);
  const leftCents = control.diaLimit > 0 ? control.diaLeft : null;
  let body = `Esta semana gastaram ${eur(Math.max(0, spentCents))} € no dia a dia.`;
  if (leftCents != null) {
    body +=
      leftCents >= 0
        ? ` Ainda podem gastar ${eur(leftCents)} € até dia ${daysInMonth(month)}.`
        : ` O dia a dia já passou o limite do mês em ${eur(-leftCents)} €.`;
  }
  return { spentCents, leftCents, body };
}

// ── Month close (day 1) ─────────────────────────────────────────────────────

/** What monthly_snapshots.metrics keeps of a closed month (cents). */
export function closeMetrics(b: MonthBreakdown, plan: PlanTotals | null, saldoFim: number | null) {
  return {
    version: 2,
    status: b.status,
    entrou: b.entrou,
    casa: b.casa,
    fixas: b.fixas,
    dia: b.dia,
    trabalho: b.trabalho,
    voces: b.voces,
    semSaiu: b.semSaiu,
    semCount: b.semCount,
    sobrou: b.sobrou,
    pontualIn: b.pontualIn,
    pontualOut: b.pontualOut,
    poupancaPara: b.poupancaPara,
    poupancaDe: b.poupancaDe,
    saldoFim,
    plano: plan
      ? {
          R: plan.R,
          J: plan.J,
          F: plan.F,
          V: plan.V,
          A: plan.A,
          P: plan.P,
          D: plan.D,
          mesadaPossivel: plan.mesadaPossivel,
          mesadasTotal: plan.mesadasTotal,
          folga: plan.folga,
          folgaSemJoana: plan.folgaSemJoana,
        }
      : null,
  };
}

/** "Setembro fechou: sobraram 840 €. 3 movimentos sem categoria." */
export function closeMessage(b: Pick<MonthBreakdown, "month" | "sobrou" | "semCount">): { title: string; body: string; url: string } {
  const head =
    b.sobrou >= 0
      ? `${monthNamePt(b.month)} fechou: sobraram ${eur(b.sobrou)} €.`
      : `${monthNamePt(b.month)} fechou: faltaram ${eur(-b.sobrou)} €.`;
  const sem = b.semCount === 1 ? " 1 movimento sem categoria." : b.semCount > 1 ? ` ${b.semCount} movimentos sem categoria.` : "";
  return { title: "Fecho do mês", body: head + sem, url: `/meses/${b.month}` };
}
