import { supabase } from "@/lib/supabase";
import type { Member, Settings } from "@/lib/types";

export async function loadMembers(householdId: string): Promise<Member[]> {
  const { data } = await supabase
    .from("members")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at");
  return (data as Member[]) ?? [];
}

export async function updateMesada(
  memberId: string,
  mesadaCents: number,
  mesadaDay: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({ mesada_cents: mesadaCents, mesada_day: mesadaDay })
    .eq("id", memberId);
  if (error) throw error;
}

export async function loadSettings(householdId: string): Promise<Settings | null> {
  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("household_id", householdId)
    .maybeSingle();
  return (data as Settings) ?? null;
}

export async function setCushionTarget(
  householdId: string,
  months: number,
): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert(
      { household_id: householdId, cushion_target_months: months },
      { onConflict: "household_id" },
    );
  if (error) throw error;
}

export async function setPriceTable(
  householdId: string,
  priceTable: Record<string, number>,
): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert(
      { household_id: householdId, price_table: priceTable },
      { onConflict: "household_id" },
    );
  if (error) throw error;
}
