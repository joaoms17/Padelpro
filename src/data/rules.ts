import { supabase } from "@/lib/supabase";
import { invokeFn } from "@/lib/invoke";
import { normalizeMerchant } from "@shared/categorize";
import type { Rule } from "@/lib/types";

export async function listRules(householdId: string): Promise<Rule[]> {
  const { data } = await supabase
    .from("rules")
    .select("*")
    .eq("household_id", householdId)
    .order("priority");
  return (data as Rule[]) ?? [];
}

export async function createRule(input: {
  householdId: string;
  field: Rule["field"];
  matchType: Rule["match_type"];
  pattern: string;
  categoryId: string;
  priority?: number;
  createdBy?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("rules").insert({
    household_id: input.householdId,
    field: input.field,
    match_type: input.matchType,
    pattern: input.pattern,
    category_id: input.categoryId,
    priority: input.priority ?? 100,
    created_by: input.createdBy ?? null,
  });
  if (error) throw error;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.from("rules").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Apply a merchant rule to past movements. Only touches movements that are
 * uncategorized or were categorized automatically (ai/history) — never
 * overwrites a category the user set by hand, a rule/mesada match, or a split.
 */
export async function applyMerchantToPast(
  householdId: string,
  merchantKey: string,
  categoryId: string,
): Promise<void> {
  if (!merchantKey) return;
  // merchant_clean stores the title-cased normalized merchant; match loosely.
  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId, category_source: "rule", updated_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .ilike("merchant_clean", `%${merchantKey}%`)
    .or("category_id.is.null,category_source.in.(ai,history)");
  if (error) throw error;
}

/** Create a "always categorize this merchant" rule from a movement. */
export async function learnMerchantRule(input: {
  householdId: string;
  descriptionRaw: string | null;
  categoryId: string;
  createdBy?: string | null;
  applyToPast: boolean;
}): Promise<void> {
  const key = normalizeMerchant(input.descriptionRaw);
  if (!key) return;
  await createRule({
    householdId: input.householdId,
    field: "merchant",
    matchType: "contains",
    pattern: key,
    categoryId: input.categoryId,
    createdBy: input.createdBy,
  });
  if (input.applyToPast) {
    await applyMerchantToPast(input.householdId, key, input.categoryId);
  }
}

/** Run the server-side categorization engine (rules → mesada → history → AI). */
export async function runCategorize(
  householdId: string,
): Promise<{ processed: number; assigned: number; review: number; ai_error?: string | null }> {
  return invokeFn("categorize", { household_id: householdId });
}
