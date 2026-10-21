// Mesadas month by month: the agreed value per person and what each one
// actually took from the house account. Pure and testable.
import type { Category, Member } from "./types";
import type { MesadaMonth } from "@/data/mesadas";

/** A person's mesada in a month: the value set for that month, else the base. */
export function mesadaFor(member: Pick<Member, "id" | "mesada_cents">, month: string, overrides: MesadaMonth[]): number {
  const o = overrides.find((x) => x.member_id === member.id && x.month.slice(0, 7) === month);
  return o ? o.amount_cents : member.mesada_cents || 0;
}

export function isOverride(memberId: string, month: string, overrides: MesadaMonth[]): boolean {
  return overrides.some((x) => x.member_id === memberId && x.month.slice(0, 7) === month);
}

/**
 * What each person took in a month: money out in their mesada category (the
 * mesada category whose name mentions them).
 */
export function takenByMember(
  tx: { category_id: string | null; amount_cents: number; booking_date: string }[],
  categories: Pick<Category, "id" | "grp" | "name">[],
  members: Pick<Member, "id" | "display_name">[],
): Map<string, Map<string, number>> {
  const catOf = new Map<string, string>();
  for (const m of members) {
    const name = (m.display_name ?? "").trim().toLowerCase();
    const cat = categories.find((c) => c.grp === "mesada" && name && c.name.toLowerCase().includes(name));
    if (cat) catOf.set(cat.id, m.id);
  }
  const out = new Map<string, Map<string, number>>(members.map((m) => [m.id, new Map()]));
  for (const t of tx) {
    const who = t.category_id ? catOf.get(t.category_id) : undefined;
    if (!who) continue;
    const month = t.booking_date.slice(0, 7);
    const per = out.get(who)!;
    per.set(month, (per.get(month) ?? 0) - t.amount_cents);
  }
  return out;
}
