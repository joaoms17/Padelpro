// Checking money in: what should have reached the Santander account each
// month against what did. Pure and testable.

// Expected incomes month by month: shared with the Edge Functions.
export * from "@shared/engine/conferir.ts";

export interface JoanaMonth {
  month: string;
  /** Marked as received in the Duet app (by payment date). */
  duetCents: number;
  /** Her money that reached the Santander account. */
  bankCents: number;
  /** Part of the difference that is not owed (set by hand, or before she started transferring). */
  waivedCents: number;
  /** Before her transfers started: the whole difference is not owed. */
  autoWaived: boolean;
  /** duet − bank − waived: positive = still to transfer. */
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
  waivers: Record<string, number> = {},
  /** First month her money goes to the Santander account (earlier ones are not owed). */
  from?: string,
): JoanaMonth[] {
  const d = sumByMonth(duet);
  const b = sumByMonth(bank);
  let running = 0;
  return months.map((month) => {
    const duetCents = d.get(month) ?? 0;
    const bankCents = b.get(month) ?? 0;
    const gap = Math.max(0, duetCents - bankCents);
    const autoWaived = !!from && month < from;
    const waivedCents = autoWaived ? gap : Math.min(gap, Math.max(0, waivers[month] ?? 0));
    const diffCents = duetCents - bankCents - waivedCents;
    running += diffCents;
    return { month, duetCents, bankCents, waivedCents, autoWaived, diffCents, runningCents: running };
  });
}
