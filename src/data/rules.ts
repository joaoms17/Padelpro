import { supabase } from "@/lib/supabase";
import { invokeFn } from "@/lib/invoke";
import { isUsableKeyword, matchesKeyword, normalizeKeyword } from "@shared/categorize";
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

/**
 * Change a rule's text (keyword rules are normalised) and/or its category.
 * `toTop` puts it ahead of every other rule — used when it is re-applied to
 * past movements, so new movements are filed the same way.
 */
export async function updateRule(
  rule: Rule,
  patch: { pattern?: string; categoryId?: string; toTop?: boolean },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.toTop) {
    const { data: top, error } = await supabase
      .from("rules")
      .select("priority")
      .eq("household_id", rule.household_id)
      .neq("id", rule.id)
      .order("priority", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const best = top?.priority as number | undefined;
    if (best != null && rule.priority >= best) update.priority = best - 1;
  }
  if (patch.categoryId) update.category_id = patch.categoryId;
  if (patch.pattern != null) {
    const keywordRule = rule.field === "merchant" && rule.match_type === "contains";
    const p = keywordRule ? normalizeKeyword(patch.pattern) : patch.pattern.trim();
    if (keywordRule && !isUsableKeyword(p)) throw new Error("A regra tem de ter pelo menos 3 letras.");
    if (!p) throw new Error("A regra não pode ficar vazia.");
    update.pattern = p;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from("rules").update(update).eq("id", rule.id);
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

// A new "Aplicar sempre" may replace what was categorized automatically, by
// a suggestion or by an older rule — never a category set by hand, a mesada
// or an Apple Pay match.
const REPLACEABLE_SOURCES = ["ai", "history", "rule", "sugestao"];
const replaceable = (t: PastTx) => !t.category_id || REPLACEABLE_SOURCES.includes(t.category_source ?? "");

/** Every movement of the household matching the keyword (paged: no row cap). */
async function pastMatches(householdId: string, keyword: string): Promise<PastTx[]> {
  const out: PastTx[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, description_raw, category_id, category_source")
      .eq("household_id", householdId)
      .is("matched_transaction_id", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as PastTx[]) ?? [];
    out.push(...rows.filter((t) => matchesKeyword(t.description_raw, keyword)));
    if (rows.length < PAGE) break;
  }
  return out;
}

/** How many movements a keyword catches, and how many it would re-categorize. */
export async function previewKeyword(
  householdId: string,
  keyword: string,
): Promise<{ keyword: string; matches: number; willChange: number }> {
  const k = normalizeKeyword(keyword);
  if (!isUsableKeyword(k)) return { keyword: k, matches: 0, willChange: 0 };
  const rows = await pastMatches(householdId, k);
  return { keyword: k, matches: rows.length, willChange: rows.filter(replaceable).length };
}

/**
 * Apply a keyword rule to past movements, matching exactly like the server
 * rule engine does. The "not set by hand" condition is re-checked in each
 * UPDATE, so a category someone sets meanwhile is never overwritten.
 */
export async function applyKeywordToPast(
  householdId: string,
  keyword: string,
  categoryId: string,
): Promise<number> {
  const ids = (await pastMatches(householdId, keyword)).filter(replaceable).map((t) => t.id);
  let updated = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("transactions")
      .update({ category_id: categoryId, category_source: "rule", updated_at: new Date().toISOString() })
      .in("id", ids.slice(i, i + 100))
      .or(`category_id.is.null,category_source.in.(${REPLACEABLE_SOURCES.join(",")})`)
      .select("id");
    if (error) throw error;
    updated += data?.length ?? 0;
  }
  return updated;
}

/**
 * Create an "always categorize movements containing <keyword>" rule. It is
 * placed ahead of every existing rule, so re-filing a merchant (e.g. Uber
 * Eats out of Restaurantes) wins over an older rule for it.
 */
export async function learnKeywordRule(input: {
  householdId: string;
  keyword: string;
  categoryId: string;
  createdBy?: string | null;
  applyToPast: boolean;
}): Promise<number> {
  const pattern = normalizeKeyword(input.keyword);
  if (!isUsableKeyword(pattern)) throw new Error("A palavra-chave tem de ter pelo menos 3 letras.");
  const { data: top } = await supabase
    .from("rules")
    .select("priority")
    .eq("household_id", input.householdId)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();
  await createRule({
    householdId: input.householdId,
    field: "merchant",
    matchType: "contains",
    pattern,
    categoryId: input.categoryId,
    priority: Math.min(100, ((top?.priority as number | undefined) ?? 100) - 1),
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
