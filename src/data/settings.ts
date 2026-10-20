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

export interface JoanaSource {
  id: string;
  household_id: string;
  label: string;
  name_pattern: string | null;
}

export async function listJoanaSources(householdId: string): Promise<JoanaSource[]> {
  const { data } = await supabase
    .from("joana_source_accounts")
    .select("*")
    .eq("household_id", householdId)
    .order("label");
  return (data as JoanaSource[]) ?? [];
}

export async function addJoanaSource(householdId: string, label: string, namePattern: string): Promise<void> {
  const { error } = await supabase
    .from("joana_source_accounts")
    .insert({ household_id: householdId, label, name_pattern: namePattern });
  if (error) throw error;
}

export async function deleteJoanaSource(id: string): Promise<void> {
  const { error } = await supabase.from("joana_source_accounts").delete().eq("id", id);
  if (error) throw error;
}
