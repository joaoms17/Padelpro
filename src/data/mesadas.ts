import { supabase } from "@/lib/supabase";

export interface MesadaMonth {
  member_id: string;
  month: string; // YYYY-MM-01
  amount_cents: number;
}

/** Per-month mesadas set by hand (months without a row use the base value). */
export async function loadMesadaMonths(householdId: string): Promise<MesadaMonth[]> {
  const { data, error } = await supabase
    .from("mesada_months")
    .select("member_id, month, amount_cents")
    .eq("household_id", householdId);
  // Before migration 0014 the table does not exist: base values only.
  if (error) return [];
  return (data as MesadaMonth[]) ?? [];
}

/** Set a person's mesada for one month, or (null) go back to the base value. */
export async function setMesadaMonth(
  householdId: string,
  memberId: string,
  month: string,
  cents: number | null,
): Promise<void> {
  const day1 = `${month.slice(0, 7)}-01`;
  if (cents == null) {
    const { error } = await supabase.from("mesada_months").delete().eq("member_id", memberId).eq("month", day1);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("mesada_months").upsert(
    { household_id: householdId, member_id: memberId, month: day1, amount_cents: Math.max(0, Math.round(cents)), updated_at: new Date().toISOString() },
    { onConflict: "member_id,month" },
  );
  if (error) throw error;
}
