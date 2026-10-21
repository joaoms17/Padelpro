// Limits and pace — pure and testable; shared by the app (src/lib/budget.ts)
// and the Edge Functions. Amounts are integer cents.

export type BudgetLevel = "ok" | "warn" | "over";

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
