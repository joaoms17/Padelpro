// Checking money in: what should have reached the Santander account each
// month against what did. Pure and testable.
import { incomeStatus, isDueInMonth, looselyFits, maxPartFor, type Credit, type ExpectedIncome } from "./forecast";

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
  /** Its usual day is before the bank history starts: nothing to check. */
  noData: boolean;
  /** The transfers counted for this month. */
  credits: { date: string; amount_cents: number }[];
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
  /** First day with bank movements (history before it is unknown). */
  dataFrom?: string,
): Map<string, IncomeMonth[]> {
  // Every transfer counted for each income, oldest first.
  const got = new Map<string, Credit[]>(incomes.map((i) => [i.id, []]));
  const byId = new Map(credits.map((c) => [c.id, c]));
  for (const month of months) {
    const inMonth = credits
      .filter((c) => c.booking_date.slice(0, 7) === month)
      .sort((x, y) => x.booking_date.localeCompare(y.booking_date));
    const statuses = incomeStatus(incomes, inMonth, month, today);
    const used = new Set(statuses.flatMap((s) => s.creditIds));
    for (const s of statuses) got.get(s.income.id)!.push(...s.creditIds.map((id) => byId.get(id)!));
    // Extra transfers (catching up, or in a month it isn't due) go to the
    // income they fit best, whatever the day.
    for (const c of inMonth) {
      if (used.has(c.id) || c.amount_cents <= 0) continue;
      const fits = incomes
        .filter((i) => i.match_text && looselyFits(c, i.match_text, i.amount_cents / Math.max(1, i.parts), maxPartFor(i, incomes)))
        .sort((x, y) => partGap(c, x) - partGap(c, y));
      if (fits[0]) got.get(fits[0].id)!.push(c);
    }
  }

  const out = new Map<string, IncomeMonth[]>();
  for (const inc of incomes) {
    const parts = Math.max(1, inc.parts);
    const part = inc.amount_cents / parts;
    const queue = got.get(inc.id)!.sort((x, y) => x.booking_date.localeCompare(y.booking_date));
    let next = 0;
    out.set(
      inc.id,
      months.map((month) => {
        const due = isDueInMonth(inc, month);
        if (!due) return { month, due, expectedCents: 0, receivedCents: 0, missingCents: 0, noData: false, credits: [] };
        // Paid before the bank history starts (allowing for it coming a few days late).
        const usual = `${month}-${String(Math.min(inc.day + 7, 28)).padStart(2, "0")}`;
        if (dataFrom && usual < dataFrom) {
          return { month, due, expectedCents: inc.amount_cents, receivedCents: 0, missingCents: 0, noData: true, credits: [] };
        }
        // Each due month takes its parts from the oldest transfers left; the
        // amounts may vary (salary), a part counts once it looks like one.
        let received = 0;
        let whole = 0;
        const counted: { date: string; amount_cents: number }[] = [];
        while (next < queue.length && whole < parts && received < inc.amount_cents * 0.95) {
          const c = queue[next++];
          received += c.amount_cents;
          counted.push({ date: c.booking_date, amount_cents: c.amount_cents });
          if (c.amount_cents >= part * 0.7) whole++;
        }
        const done = whole >= parts || received >= inc.amount_cents * 0.95;
        return {
          month,
          due,
          expectedCents: inc.amount_cents,
          receivedCents: received,
          missingCents: done ? 0 : Math.max(0, inc.amount_cents - received),
          noData: false,
          credits: counted,
        };
      }),
    );
  }
  return out;
}

const partGap = (c: Credit, i: ExpectedIncome) =>
  Math.abs(c.amount_cents - i.amount_cents / Math.max(1, i.parts)) / (i.amount_cents / Math.max(1, i.parts));
