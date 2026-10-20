// Checking money in: what should have reached the Santander account each
// month against what did. Pure and testable.
import { incomeStatus, isDueInMonth, looselyFits, type Credit, type ExpectedIncome } from "./forecast";

export interface JoanaMonth {
  month: string;
  /** Marked as received in the Duet app (by payment date). */
  duetCents: number;
  /** Credits in the "Eventos Joana" category in the Santander account. */
  bankCents: number;
  /** duet − bank: positive = still to transfer (or to categorize). */
  diffCents: number;
  /** Running difference since the first month shown. */
  runningCents: number;
}

const sumByMonth = (items: { date: string; amount_cents: number }[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.date.slice(0, 7), (m.get(i.date.slice(0, 7)) ?? 0) + i.amount_cents);
  return m;
};

export function joanaMonths(
  months: string[],
  duet: { date: string; amount_cents: number }[],
  bank: { date: string; amount_cents: number }[],
): JoanaMonth[] {
  const d = sumByMonth(duet);
  const b = sumByMonth(bank);
  let running = 0;
  return months.map((month) => {
    const duetCents = d.get(month) ?? 0;
    const bankCents = b.get(month) ?? 0;
    running += duetCents - bankCents;
    return { month, duetCents, bankCents, diffCents: duetCents - bankCents, runningCents: running };
  });
}

export interface IncomeMonth {
  month: string;
  due: boolean;
  expectedCents: number;
  /** Covered for this month, from everything received (oldest months first). */
  receivedCents: number;
  missingCents: number;
}

/**
 * Each expected income, month by month: expected vs covered. Payments are
 * pooled and cover the oldest months first, so two transfers in August pay
 * July and August, and one sent early covers the next month.
 */
export function incomeMonths(
  incomes: ExpectedIncome[],
  credits: Credit[],
  months: string[],
  today: string,
): Map<string, IncomeMonth[]> {
  const received = new Map<string, number>(incomes.map((i) => [i.id, 0]));
  for (const month of months) {
    const inMonth = credits.filter((c) => c.booking_date.slice(0, 7) === month);
    const statuses = incomeStatus(incomes, inMonth, month, today);
    const used = new Set(statuses.flatMap((s) => s.creditIds));
    for (const s of statuses) received.set(s.income.id, received.get(s.income.id)! + s.receivedCents);
    // Extra transfers (catching up, or in a month it isn't due) go to the
    // income they fit best, whatever the day.
    for (const c of inMonth) {
      if (used.has(c.id) || c.amount_cents <= 0) continue;
      const fits = incomes
        .filter((i) => i.match_text && looselyFits(c, i.match_text, i.amount_cents / Math.max(1, i.parts)))
        .sort((x, y) => partGap(c, x) - partGap(c, y));
      if (fits[0]) received.set(fits[0].id, received.get(fits[0].id)! + c.amount_cents);
    }
  }

  const out = new Map<string, IncomeMonth[]>();
  for (const inc of incomes) {
    let pool = received.get(inc.id)!;
    out.set(
      inc.id,
      months.map((month) => {
        const due = isDueInMonth(inc, month);
        if (!due) return { month, due, expectedCents: 0, receivedCents: 0, missingCents: 0 };
        const covered = Math.min(inc.amount_cents, pool);
        pool -= covered;
        const missing = covered >= inc.amount_cents * 0.95 ? 0 : inc.amount_cents - covered;
        return { month, due, expectedCents: inc.amount_cents, receivedCents: covered, missingCents: missing };
      }),
    );
  }
  return out;
}

const partGap = (c: Credit, i: ExpectedIncome) =>
  Math.abs(c.amount_cents - i.amount_cents / Math.max(1, i.parts)) / (i.amount_cents / Math.max(1, i.parts));
