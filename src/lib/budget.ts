// Budget + recurring-fixed logic — pure and testable (spec 6.3, 7).
// Amounts are integer cents; expenses are negative, entradas positive.

export interface MonthTx {
  category_id: string | null;
  amount_cents: number;
  booking_date: string;
  counterparty: string | null;
  merchant_clean: string | null;
  account_id?: string;
  id?: string;
  description_raw?: string | null;
}

export type BudgetLevel = "ok" | "warn" | "over";

export interface CategoryProgress {
  categoryId: string;
  spentCents: number;
  budgetCents: number | null;
  pct: number; // 0..>1
  level: BudgetLevel;
  projectedCents: number; // spend projected to end of month at current pace
  paceOver: boolean; // projected to exceed budget
}

/** Spend per category in a month (only the expense side). */
export function spentByCategory(txs: MonthTx[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txs) {
    if (!t.category_id) continue;
    const expense = Math.max(0, -t.amount_cents);
    if (expense === 0) continue;
    out.set(t.category_id, (out.get(t.category_id) ?? 0) + expense);
  }
  return out;
}

export function budgetLevel(spent: number, budget: number | null): BudgetLevel {
  if (!budget || budget <= 0) return "ok";
  const pct = spent / budget;
  if (pct >= 1) return "over";
  if (pct >= 0.8) return "warn";
  return "ok";
}

/** Project month-end spend from the pace so far. */
export function paceProjection(
  spentCents: number,
  dayOfMonth: number,
  daysInMonth: number,
): number {
  if (dayOfMonth <= 0) return spentCents;
  return Math.round((spentCents / dayOfMonth) * daysInMonth);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function categoryProgress(
  categoryId: string,
  spentCents: number,
  budgetCents: number | null,
  month: string,
  today: string,
): CategoryProgress {
  const dim = daysInMonth(month);
  // Only project within the current month; a past month is fully elapsed.
  const sameMonth = today.slice(0, 7) === month;
  const day = sameMonth ? Number(today.slice(8, 10)) : dim;
  const projectedCents = paceProjection(spentCents, day, dim);
  const pct = budgetCents && budgetCents > 0 ? spentCents / budgetCents : 0;
  return {
    categoryId,
    spentCents,
    budgetCents,
    pct,
    level: budgetLevel(spentCents, budgetCents),
    projectedCents,
    paceOver: Boolean(budgetCents && budgetCents > 0 && projectedCents > budgetCents),
  };
}

// ── Recurring fixed detection (spec 6.3) ────────────────────────────────────

export interface RecurringCandidate {
  key: string; // normalized counterparty / merchant
  expectedCents: number; // median expense
  expectedDay: number; // median day of month
  occurrences: number;
  lastSeen: string;
}

function keyOf(t: MonthTx): string {
  return (t.counterparty || t.merchant_clean || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Detect monthly recurring expenses: same counterparty, roughly monthly
 * cadence (28–35 days apart), similar amounts. Returns one candidate per key
 * that recurs at least `minOccurrences` times.
 */
export function recurringCandidates(
  txs: MonthTx[],
  minOccurrences = 2,
): RecurringCandidate[] {
  const groups = new Map<string, MonthTx[]>();
  for (const t of txs) {
    if (t.amount_cents >= 0) continue; // expenses only
    const k = keyOf(t);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }

  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < minOccurrences) continue;
    const sorted = [...list].sort((a, b) => (a.booking_date < b.booking_date ? -1 : 1));

    // Check the gaps look monthly.
    let monthly = true;
    for (let i = 1; i < sorted.length; i++) {
      const gap = dayGap(sorted[i - 1].booking_date, sorted[i].booking_date);
      if (gap < 24 || gap > 38) {
        monthly = false;
        break;
      }
    }
    if (!monthly) continue;

    const amounts = sorted.map((t) => Math.abs(t.amount_cents));
    const days = sorted.map((t) => Number(t.booking_date.slice(8, 10)));
    out.push({
      key,
      expectedCents: median(amounts),
      expectedDay: median(days),
      occurrences: sorted.length,
      lastSeen: sorted[sorted.length - 1].booking_date,
    });
  }
  return out.sort((a, b) => b.expectedCents - a.expectedCents);
}

function dayGap(a: string, b: string): number {
  const da = Date.parse(a.slice(0, 10) + "T00:00:00Z");
  const db = Date.parse(b.slice(0, 10) + "T00:00:00Z");
  return Math.round((db - da) / 86400000);
}

/** A fixed charge changed if it moved by more than 2% or 2 € (spec 6.3). */
export function fixedChanged(expectedCents: number, actualCents: number): boolean {
  const diff = Math.abs(actualCents - expectedCents);
  return diff > 200 || diff > expectedCents * 0.02;
}

/** A fixed charge is overdue if it hasn't appeared 5+ days past its usual day. */
export function fixedOverdue(
  expectedDay: number,
  today: string,
  seenThisMonth: boolean,
): boolean {
  if (seenThisMonth) return false;
  return Number(today.slice(8, 10)) > expectedDay + 5;
}
