// What the two of you look at first: the account's balance over the months,
// how much you both took, and whether Joana's Duet money all reached the account.
import { monthShort } from "./format";

/** Together you mean to take up to this much a month. */
export const VOCES_MARK = 100000;

export interface BalancePoint {
  month: string;
  label: string;
  cents: number;
  current: boolean;
}

/** The balance at the end of the last `n` months; the current month is today's. */
export function balanceSeries(months: string[], endBalance: Map<string, number> | null, current: string, n = 6): BalancePoint[] {
  if (!endBalance) return [];
  return months
    .filter((m) => m <= current && endBalance.has(m))
    .slice(-n)
    .map((m) => ({ month: m, label: m === current ? "Hoje" : monthShort(m), cents: endBalance.get(m)!, current: m === current }));
}

/** How much the balance moved since the end of last month (null without one). */
export function balanceChange(series: BalancePoint[]): number | null {
  if (series.length < 2 || !series[series.length - 1].current) return null;
  return series[series.length - 1].cents - series[series.length - 2].cents;
}

export interface VocesPoint {
  month: string;
  label: string;
  cents: number;
  /** Reached the mark (1 000 € or more). */
  over: boolean;
}

/** What the two of you took in each of the last `n` months, newest last. */
export function vocesSeries(months: string[], voces: (month: string) => number, current: string, n = 4, mark = VOCES_MARK): VocesPoint[] {
  return months
    .filter((m) => m <= current)
    .slice(-n)
    .map((m) => {
      const cents = voces(m);
      return { month: m, label: monthShort(m), cents, over: cents >= mark };
    });
}

export interface OwedStatus {
  /** Past its usual day and not in the account yet. */
  late: number;
  /** Still to come, not late: the earliest day it is expected. */
  nextDay: number | null;
  /** What is still to come and not late. */
  upcoming: number;
}

/**
 * João's side of the same question asked of Joana: did the salary and the
 * despesas de representação due this month reach the account? Before their
 * usual day they are only "to come"; after it they are missing.
 */
export function salaryStatus(groups: { kind: string; day: number; pending: number }[], dayOfMonth: number): OwedStatus {
  const mine = groups.filter((g) => (g.kind === "salario" || g.kind === "representacao") && g.pending > 0);
  const late = mine.filter((g) => g.day < dayOfMonth);
  const soon = mine.filter((g) => g.day >= dayOfMonth);
  return {
    late: late.reduce((a, g) => a + g.pending, 0),
    upcoming: soon.reduce((a, g) => a + g.pending, 0),
    nextDay: soon.length ? Math.min(...soon.map((g) => g.day)) : null,
  };
}
