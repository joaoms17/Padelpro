// Checking money in: what should have reached the Santander account each
// month against what did. Pure and testable.
import { incomeStatus, type Credit, type ExpectedIncome, isDueInMonth } from "./forecast";

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
  receivedCents: number;
  missingCents: number;
}

/** Each expected income, month by month: expected vs what arrived. */
export function incomeMonths(
  incomes: ExpectedIncome[],
  credits: Credit[],
  months: string[],
  today: string,
): Map<string, IncomeMonth[]> {
  const out = new Map<string, IncomeMonth[]>(incomes.map((i) => [i.id, []]));
  for (const month of months) {
    const st = new Map(
      incomeStatus(incomes, credits.filter((c) => c.booking_date.slice(0, 7) === month), month, today).map((s) => [s.income.id, s]),
    );
    for (const inc of incomes) {
      const s = st.get(inc.id);
      const due = isDueInMonth(inc, month);
      out.get(inc.id)!.push({
        month,
        due,
        expectedCents: due ? inc.amount_cents : 0,
        receivedCents: s?.receivedCents ?? 0,
        missingCents: due ? s?.pendingCents ?? inc.amount_cents : 0,
      });
    }
  }
  return out;
}
