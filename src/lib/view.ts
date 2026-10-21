// Every month's accounts for the screens, computed once from the engine data.
import {
  monthBreakdown,
  monthEndBalances,
  monthsBetween,
  referenceAverages,
  type Averages,
  type MonthBreakdown,
} from "./month";
import type { EngineData } from "@/data/engine";

export interface MonthsView {
  /** From the first month with data to the current one. */
  months: string[];
  current: string;
  /** Ended months with whole data (August on), newest last. */
  closed: string[];
  /** The latest closed month (what Meses opens on). */
  lastClosed: string | null;
  real: Map<string, MonthBreakdown>;
  semPontuais: Map<string, MonthBreakdown>;
  averages: Averages;
  /** Balance at the end of each month (null without a known balance). */
  endBalance: Map<string, number> | null;
}

export function buildMonthsView(data: EngineData): MonthsView {
  const current = data.ctx.today.slice(0, 7);
  const first = data.ctx.firstDataDate ?? data.ctx.today;
  const months = monthsBetween(first, current);
  const real = new Map(months.map((m) => [m, monthBreakdown(data.txs, data.ctx, m)]));
  const semPontuais = new Map(months.map((m) => [m, monthBreakdown(data.txs, data.ctx, m, { semPontuais: true })]));
  const closed = months.filter((m) => {
    const s = real.get(m)!.status;
    return s === "provisorio" || s === "completo";
  });
  return {
    months,
    current,
    closed,
    lastClosed: closed[closed.length - 1] ?? null,
    real,
    semPontuais,
    averages: referenceAverages(closed.map((m) => semPontuais.get(m)!)),
    endBalance: data.balanceCents == null ? null : monthEndBalances(data.txs, data.balanceCents, months),
  };
}
