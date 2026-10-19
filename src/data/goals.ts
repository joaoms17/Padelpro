import { supabase } from "@/lib/supabase";
import type { Goal } from "@/lib/types";

export async function listGoals(householdId: string): Promise<Goal[]> {
  const { data } = await supabase
    .from("goals")
    .select("*")
    .eq("household_id", householdId)
    .order("due_date", { ascending: true });
  return (data as Goal[]) ?? [];
}

export async function createGoal(input: {
  householdId: string;
  name: string;
  targetCents: number;
  dueDate: string | null;
}): Promise<void> {
  const { error } = await supabase.from("goals").insert({
    household_id: input.householdId,
    name: input.name,
    target_cents: input.targetCents,
    due_date: input.dueDate,
    reserved_cents: 0,
  });
  if (error) throw error;
}

export async function reserveGoal(id: string, reservedCents: number): Promise<void> {
  const { error } = await supabase
    .from("goals")
    .update({ reserved_cents: Math.max(0, reservedCents) })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) throw error;
}
