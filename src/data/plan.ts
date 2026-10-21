import { supabase } from "@/lib/supabase";
import { addMonth } from "@/lib/forecast";
import { JOANA_FROM } from "@/lib/month";
import type { PlanSettings } from "@/lib/plan";
import type { Member } from "@/lib/types";
import { setMesadaMonth } from "@/data/mesadas";

/** Save the plan (settings.plan, migration 0015). */
export async function savePlan(householdId: string, plan: PlanSettings): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ household_id: householdId, plan }, { onConflict: "household_id" });
  if (error) throw error;
}

/** A category's monthly limit (dia a dia) or expected value (contas fixas); null clears it. */
export async function setBudget(categoryId: string, cents: number | null): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ budget_cents: cents && cents > 0 ? Math.round(cents) : null })
    .eq("id", categoryId);
  if (error) throw error;
}

/** Several limits at once (e.g. "usar as médias"). */
export async function setBudgets(values: Record<string, number | null>): Promise<void> {
  for (const [id, cents] of Object.entries(values)) await setBudget(id, cents);
}

/**
 * Put the plan in place from its first month: each one's mesada and day,
 * the transition months before it (João keeps his 500 €, Joana 0), and the
 * plan marked as active.
 */
export async function putPlanInPlace(
  householdId: string,
  plan: PlanSettings,
  members: Pick<Member, "id">[],
): Promise<void> {
  for (const m of members) {
    const { error } = await supabase
      .from("members")
      .update({ mesada_cents: Math.max(0, plan.mesadas[m.id] ?? 0), mesada_day: plan.mesada_day })
      .eq("id", m.id);
    if (error) throw error;
    for (let month = JOANA_FROM; month < plan.start_month; month = addMonth(month, 1)) {
      await setMesadaMonth(householdId, m.id, month, Math.max(0, plan.transition[m.id] ?? 0));
    }
  }
  await savePlan(householdId, { ...plan, active: true });
}
