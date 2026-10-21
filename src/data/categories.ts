import { supabase } from "@/lib/supabase";
import { GROUP_ORDER } from "@/lib/categories";
import type { Category, CategoryGroup } from "@/lib/types";

/** Sort values of a group: 10, 20, 30… after the group's base (entrada 0, fixa 1000…). */
const groupBase = (grp: CategoryGroup) => GROUP_ORDER.indexOf(grp) * 1000;

/** Next sort value at the end of a group. */
function nextSort(categories: Category[], grp: CategoryGroup): number {
  const inGroup = categories.filter((c) => c.grp === grp).map((c) => c.sort);
  return inGroup.length ? Math.max(...inGroup) + 10 : groupBase(grp) + 10;
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

/** Rename and/or move a category to another group ("separador", at its end) — one update. */
export async function updateCategory(
  categories: Category[],
  category: Category,
  patch: { name?: string; grp?: CategoryGroup },
): Promise<void> {
  const update: Record<string, unknown> = {};
  const name = patch.name?.trim();
  if (name && name !== category.name) update.name = name;
  if (patch.grp && patch.grp !== category.grp) {
    update.grp = patch.grp;
    update.sort = nextSort(categories, patch.grp);
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from("categories").update(update).eq("id", category.id);
  if (error) throw error;
}

/**
 * Move a category one place up (-1) or down (+1) within its group. The whole
 * group is renumbered 10, 20, 30…, so equal or crowded sort values never
 * leave a click without effect.
 */
export async function moveCategoryInGroup(
  categories: Category[],
  category: Category,
  delta: -1 | 1,
): Promise<void> {
  const group = categories
    .filter((c) => c.grp === category.grp)
    .sort((a, b) => a.sort - b.sort);
  const i = group.findIndex((c) => c.id === category.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.length) return;
  [group[i], group[j]] = [group[j], group[i]];
  const base = groupBase(category.grp);
  for (const [k, c] of group.entries()) {
    const sort = base + (k + 1) * 10;
    if (c.sort === sort) continue;
    const { error } = await supabase.from("categories").update({ sort }).eq("id", c.id);
    if (error) throw error;
  }
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
 * Remove a category: in one database transaction (merge_category, migration
 * 0010) its movements, split parts and rules move to `targetId`, its budget
 * joins the target's when both are in the same group, and it is archived
 * pointing at the target — so a phone still showing the old list files new
 * movements under the target too.
 */
export async function removeCategory(id: string, targetId: string): Promise<void> {
  if (id === targetId) throw new Error("Escolhe outra categoria para os movimentos.");
  const { error } = await supabase.rpc("merge_category", { p_from: id, p_to: targetId });
  if (error) throw error;
}
