import { supabase } from "@/lib/supabase";
import type { MonthTx } from "@/lib/budget";

function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [start, end];
}

export async function loadMonthTx(householdId: string, month: string): Promise<MonthTx[]> {
  const [start, end] = monthRange(month);
  const { data } = await supabase
    .from("transactions")
    .select("category_id, amount_cents, booking_date, counterparty, merchant_clean, account_id")
    .eq("household_id", householdId)
    .is("matched_transaction_id", null)
    .gte("booking_date", start)
    .lt("booking_date", end)
    .limit(2000);
  return (data as MonthTx[]) ?? [];
}

/** Recent history (default ~6 months) for recurring-fixed detection. */
export async function loadRecentTx(householdId: string, days = 190): Promise<MonthTx[]> {
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("transactions")
    .select("category_id, amount_cents, booking_date, counterparty, merchant_clean")
    .eq("household_id", householdId)
    .is("matched_transaction_id", null)
    .gte("booking_date", from)
    .limit(4000);
  return (data as MonthTx[]) ?? [];
}

export async function setBudget(
  categoryId: string,
  budgetCents: number | null,
  rollover?: boolean,
): Promise<void> {
  const patch: Record<string, unknown> = { budget_cents: budgetCents };
  if (rollover !== undefined) patch.rollover = rollover;
  const { error } = await supabase.from("categories").update(patch).eq("id", categoryId);
  if (error) throw error;
}
