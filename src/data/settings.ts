import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

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
