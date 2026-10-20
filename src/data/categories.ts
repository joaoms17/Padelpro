import { supabase } from "@/lib/supabase";
import { GROUP_LABELS } from "@/lib/categories";
import type { Category, CategoryGroup } from "@/lib/types";

/** Next sort value at the end of a group. */
function nextSort(categories: Category[], grp: CategoryGroup): number {
  const inGroup = categories.filter((c) => c.grp === grp).map((c) => c.sort);
  return inGroup.length ? Math.max(...inGroup) + 1 : 0;
}

export async function createCategory(
  householdId: string,
  categories: Category[],
  grp: CategoryGroup,
  name: string,
): Promise<void> {
  const { error } = await supabase.from("categories").insert({
    household_id: householdId,
    grp,
    name: name.trim(),
    sort: nextSort(categories, grp),
  });
  if (error) throw error;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("categories").update({ name: name.trim() }).eq("id", id);
  if (error) throw error;
}

/** Move a category to another group ("separador"), at the end of it. */
export async function moveCategoryToGroup(
  categories: Category[],
  id: string,
  grp: CategoryGroup,
): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ grp, sort: nextSort(categories, grp) })
    .eq("id", id);
  if (error) throw error;
}

/** Swap the order of two categories of the same group. */
export async function swapCategoryOrder(a: Category, b: Category): Promise<void> {
  // Equal sort values would not swap anything: fall back to their positions.
  const [sa, sb] = a.sort === b.sort ? [a.sort, a.sort + 1] : [a.sort, b.sort];
  const r1 = await supabase.from("categories").update({ sort: sb }).eq("id", a.id);
  if (r1.error) throw r1.error;
  const r2 = await supabase.from("categories").update({ sort: sa }).eq("id", b.id);
  if (r2.error) throw r2.error;
}

/** How many movements and rules use a category (shown before removing it). */
export async function categoryUsage(
  householdId: string,
  id: string,
): Promise<{ movements: number; rules: number }> {
  const [tx, rules] = await Promise.all([
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("category_id", id),
    supabase
      .from("rules")
      .select("id", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("category_id", id),
  ]);
  return { movements: tx.count ?? 0, rules: rules.count ?? 0 };
}

/**
 * Remove a category: its movements, split parts and rules move to `targetId`
 * first (so nothing drops out of the totals), then it is archived — kept in
 * the database for history, hidden everywhere in the app.
 */
export async function removeCategory(householdId: string, id: string, targetId: string): Promise<void> {
  if (id === targetId) throw new Error("Escolhe outra categoria para os movimentos.");
  const moves = [
    supabase.from("transactions").update({ category_id: targetId }).eq("household_id", householdId).eq("category_id", id),
    supabase.from("transaction_splits").update({ category_id: targetId }).eq("category_id", id),
    supabase.from("rules").update({ category_id: targetId }).eq("household_id", householdId).eq("category_id", id),
  ];
  for (const m of moves) {
    const { error } = await m;
    if (error) throw error;
  }
  const { error } = await supabase.from("categories").update({ archived: true }).eq("id", id);
  if (error) throw error;
}

/** Save the household's group names (blank or default = the app's name). */
export async function saveGroupLabels(
  householdId: string,
  labels: Partial<Record<CategoryGroup, string>>,
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(labels)
      .map(([k, v]) => [k, (v ?? "").trim()] as const)
      .filter(([k, v]) => v && v !== GROUP_LABELS[k as CategoryGroup]),
  );
  const { error } = await supabase
    .from("settings")
    .upsert({ household_id: householdId, group_labels: clean }, { onConflict: "household_id" });
  if (error) throw error;
}
