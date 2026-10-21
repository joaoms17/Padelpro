import { supabase } from "@/lib/supabase";
import { todayLisbon } from "@/lib/month";
import { normalizePlan, type PlanSettings } from "@/lib/plan";
import { applyPatch, appliedPatch, planMonths, type PlanPatch } from "@/lib/planPatch";
import type { Member } from "@/lib/types";
import { setMesadaMonth } from "@/data/mesadas";

/**
 * Save changes to the plan (settings.plan, migration 0015): only the fields
 * in `patch`, on top of the plan as the server has it now, so what the other
 * phone saved in the meantime stays. `fill` completes the stored plan first
 * (e.g. November's defaults). Returns the plan as saved.
 */
export async function savePlan(
  householdId: string,
  patch: PlanPatch,
  fill: (p: PlanSettings) => PlanSettings = (p) => p,
): Promise<PlanSettings> {
  const { data, error: readErr } = await supabase.from("settings").select("plan").eq("household_id", householdId).maybeSingle();
  if (readErr) throw readErr;
  const stored = (data as { plan?: Partial<PlanSettings> | null } | null)?.plan ?? null;
  const plan = applyPatch(fill(normalizePlan(stored)), patch);
  const { error } = await supabase.from("settings").upsert({ household_id: householdId, plan }, { onConflict: "household_id" });
  if (error) throw error;
  return plan;
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
 * Put the plan in place from its first month (or update it): each one's
 * mesada and day, the transition months before it (João keeps his 500 €,
 * Joana 0), and the plan marked as active. The months already lived keep the
 * mesada they had (pinned per month), so changing the base value never
 * rewrites the past. Only the values applied here (and `active`) are written
 * to the plan, on top of what the server has. Returns the plan as saved.
 */
export async function putPlanInPlace(
  householdId: string,
  plan: PlanSettings,
  members: Pick<Member, "id">[],
  fill?: (p: PlanSettings) => PlanSettings,
): Promise<PlanSettings> {
  const [{ data: rows, error: mErr }, { data: first, error: tErr }, { data: existing, error: oErr }] = await Promise.all([
    supabase.from("members").select("id, mesada_cents").eq("household_id", householdId),
    supabase.from("transactions").select("booking_date").eq("household_id", householdId).order("booking_date").limit(1),
    supabase.from("mesada_months").select("member_id, month").eq("household_id", householdId),
  ]);
  if (mErr) throw mErr;
  if (tErr) throw tErr;
  if (oErr) throw oErr;
  const base = new Map(((rows ?? []) as { id: string; mesada_cents: number }[]).map((r) => [r.id, r.mesada_cents || 0]));
  const pinned = new Set(((existing ?? []) as { member_id: string; month: string }[]).map((r) => `${r.member_id}:${r.month.slice(0, 7)}`));
  const today = todayLisbon();
  const firstMonth = (first as { booking_date: string }[] | null)?.[0]?.booking_date?.slice(0, 7) ?? today.slice(0, 7);
  const { keep, transition, from } = planMonths(firstMonth, today.slice(0, 7), plan.start_month);

  for (const m of members) {
    // The past (before the transition, and the plan's months already lived) keeps what it was.
    for (const month of keep) {
      if (pinned.has(`${m.id}:${month}`)) continue;
      await setMesadaMonth(householdId, m.id, month, base.get(m.id) ?? 0);
    }
    for (const month of transition) {
      await setMesadaMonth(householdId, m.id, month, Math.max(0, plan.transition[m.id] ?? 0));
    }
    // From then on the base value applies (no stale per-month values).
    const { error: delErr } = await supabase
      .from("mesada_months")
      .delete()
      .eq("member_id", m.id)
      .gte("month", `${from}-01`);
    if (delErr) throw delErr;
    const { error } = await supabase
      .from("members")
      .update({ mesada_cents: Math.max(0, plan.mesadas[m.id] ?? 0), mesada_day: plan.mesada_day })
      .eq("id", m.id);
    if (error) throw error;
  }
  return savePlan(householdId, appliedPatch(plan, members.map((m) => m.id)), fill);
}
