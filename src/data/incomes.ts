import { supabase } from "@/lib/supabase";
import type { Credit, ExpectedIncome } from "@/lib/forecast";
import { normalizeKeyword } from "@shared/categorize";

export async function listIncomes(householdId: string): Promise<ExpectedIncome[]> {
  const { data, error } = await supabase
    .from("expected_incomes")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at");
  // Before migration 0011 the table does not exist: simply nothing set up.
  if (error) return [];
  return (data as ExpectedIncome[]) ?? [];
}

export type IncomeInput = Omit<ExpectedIncome, "id" | "household_id" | "active">;

function clean(input: IncomeInput) {
  const label = input.label.trim();
  if (!label) throw new Error("Dá um nome a esta entrada.");
  if (!(input.amount_cents > 0)) throw new Error("O valor tem de ser maior que zero.");
  return {
    label,
    amount_cents: Math.round(input.amount_cents),
    parts: Math.min(10, Math.max(1, Math.round(input.parts))),
    day: Math.min(31, Math.max(1, Math.round(input.day))),
    every_months: Math.min(12, Math.max(1, Math.round(input.every_months))),
    anchor_month: `${input.anchor_month.slice(0, 7)}-01`,
    match_text: normalizeKeyword(input.match_text ?? "") || null,
  };
}

export async function createIncome(householdId: string, input: IncomeInput): Promise<void> {
  const { error } = await supabase.from("expected_incomes").insert({ household_id: householdId, ...clean(input) });
  if (error) throw error;
}

export async function updateIncome(id: string, input: IncomeInput): Promise<void> {
  const { error } = await supabase.from("expected_incomes").update(clean(input)).eq("id", id);
  if (error) throw error;
}

export async function deleteIncome(id: string): Promise<void> {
  const { error } = await supabase.from("expected_incomes").delete().eq("id", id);
  if (error) throw error;
}

/** Money in (positive movements) since a date, for spotting what arrived. */
export async function loadCredits(
  householdId: string,
  from: string,
): Promise<(Credit & { category_id: string | null })[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, booking_date, amount_cents, description_raw, category_id")
    .eq("household_id", householdId)
    .is("matched_transaction_id", null)
    .gt("amount_cents", 0)
    .gte("booking_date", from)
    .order("booking_date")
    .limit(3000);
  if (error) throw error;
  return (data as (Credit & { category_id: string | null })[]) ?? [];
}
