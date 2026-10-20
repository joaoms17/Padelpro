import { supabase } from "@/lib/supabase";
import { invokeFn } from "@/lib/invoke";
import { matchesKeyword, normalizeKeyword } from "@shared/categorize";
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

interface PastTx {
  id: string;
  description_raw: string | null;
  category_id: string | null;
  category_source: string | null;
}

/** A category the user did not set by hand (so a rule may replace it). */
const replaceable = (t: PastTx) => !t.category_id || t.category_source === "ai" || t.category_source === "history";

async function pastMatches(householdId: string, keyword: string): Promise<PastTx[]> {
  const { data } = await supabase
    .from("transactions")
    .select("id, description_raw, category_id, category_source")
    .eq("household_id", householdId)
    .is("matched_transaction_id", null)
    .order("booking_date", { ascending: false })
    .limit(5000);
  return ((data as PastTx[]) ?? []).filter((t) => matchesKeyword(t.description_raw, keyword));
}

/** How many movements a keyword catches, and how many it would re-categorize. */
export async function previewKeyword(
  householdId: string,
  keyword: string,
): Promise<{ matches: number; willChange: number }> {
  if (!normalizeKeyword(keyword)) return { matches: 0, willChange: 0 };
  const rows = await pastMatches(householdId, keyword);
  return { matches: rows.length, willChange: rows.filter(replaceable).length };
}

/**
 * Apply a keyword rule to past movements, matching exactly like the server
 * rule engine does. Only touches movements that are uncategorized or were
 * categorized automatically (ai/history) — never a category the user set by
 * hand, a rule/mesada match, or a split.
 */
export async function applyKeywordToPast(
  householdId: string,
  keyword: string,
  categoryId: string,
): Promise<number> {
  const ids = (await pastMatches(householdId, keyword)).filter(replaceable).map((t) => t.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase
      .from("transactions")
      .update({ category_id: categoryId, category_source: "rule", updated_at: new Date().toISOString() })
      .in("id", ids.slice(i, i + 100));
    if (error) throw error;
  }
  return ids.length;
}

/** Create an "always categorize movements containing <keyword>" rule. */
export async function learnKeywordRule(input: {
  householdId: string;
  keyword: string;
  categoryId: string;
  createdBy?: string | null;
  applyToPast: boolean;
}): Promise<number> {
  const pattern = normalizeKeyword(input.keyword);
  if (!pattern) return 0;
  await createRule({
    householdId: input.householdId,
    field: "merchant",
    matchType: "contains",
    pattern,
    categoryId: input.categoryId,
    createdBy: input.createdBy,
  });
  return input.applyToPast ? await applyKeywordToPast(input.householdId, pattern, input.categoryId) : 0;
}

/** Run the server-side categorization engine (rules → mesada → history → AI). */
export async function runCategorize(
  householdId: string,
): Promise<{
  processed: number;
  assigned: number;
  review: number;
  ai_error?: string | null;
  ai_pending?: number;
}> {
  return invokeFn("categorize", { household_id: householdId });
}
