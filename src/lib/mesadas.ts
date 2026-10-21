// Mesadas month by month: the agreed value per person and what each one
// actually took from the house account. Pure and testable.
import type { Category, CategoryGroup, Member } from "./types";
import type { MesadaMonth } from "@/data/mesadas";

/** A person's mesada in a month: the value set for that month, else the base. */
export function mesadaFor(member: Pick<Member, "id" | "mesada_cents">, month: string, overrides: MesadaMonth[]): number {
  const o = overrides.find((x) => x.member_id === member.id && x.month.slice(0, 7) === month);
  return o ? o.amount_cents : member.mesada_cents || 0;
}

export function isOverride(memberId: string, month: string, overrides: MesadaMonth[]): boolean {
  return overrides.some((x) => x.member_id === memberId && x.month.slice(0, 7) === month);
}

/** Lowercase, no accents, letters and digits only: "TRF P/ JOÃO" ~ "trf p joao". */
export const plain = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export interface PaidTx {
  category_id: string | null;
  amount_cents: number;
  booking_date: string;
  description_raw?: string | null;
}

const HOUSE: CategoryGroup[] = ["fixa", "variavel", "atividade"];

/**
 * Money out that went to the two of you rather than to the house: anything in
 * a mesada or "between accounts" category, plus any transfer with one of your
 * names in the description that isn't filed as house spending (the automatic
 * 500 € to João, a prémio passed on…). `member` says to whom, when known.
 */
export function makePaidOut(
  categories: Pick<Category, "id" | "grp" | "name">[],
  members: Pick<Member, "id" | "display_name">[],
): (t: PaidTx) => { paid: boolean; member: string | null } {
  const group = new Map(categories.map((c) => [c.id, c.grp]));
  const names = members
    .map((m) => ({ id: m.id, key: plain(m.display_name) }))
    .filter((n) => n.key.length >= 3)
    // Longest first: "joana" must not be taken for "joao" or vice-versa.
    .sort((a, b) => b.key.length - a.key.length);
  const mesadaCat = new Map<string, string>();
  for (const n of names) {
    const cat = categories.find((c) => c.grp === "mesada" && plain(c.name).split(" ").includes(n.key));
    if (cat) mesadaCat.set(cat.id, n.id);
  }
  const byName = (desc: string | null | undefined) => {
    const words = ` ${plain(desc)} `;
    return names.find((n) => words.includes(` ${n.key} `))?.id ?? null;
  };
  return (t) => {
    if (t.amount_cents >= 0) return { paid: false, member: null };
    const g = t.category_id ? group.get(t.category_id) : undefined;
    if (g && HOUSE.includes(g)) return { paid: false, member: null };
    if (g === "mesada") return { paid: true, member: (t.category_id && mesadaCat.get(t.category_id)) ?? byName(t.description_raw) };
    const who = byName(t.description_raw);
    if (g === "interna") return { paid: true, member: who };
    if (who) return { paid: true, member: who };
    return { paid: false, member: null };
  };
}

/** What each person took per month (and the transfers behind it). */
export function takenByMember(
  tx: PaidTx[],
  paidOut: ReturnType<typeof makePaidOut>,
  members: Pick<Member, "id">[],
): Map<string, Map<string, { cents: number; items: PaidTx[] }>> {
  const out = new Map<string, Map<string, { cents: number; items: PaidTx[] }>>(members.map((m) => [m.id, new Map()]));
  for (const t of tx) {
    const p = paidOut(t);
    if (!p.paid || !p.member) continue;
    const month = t.booking_date.slice(0, 7);
    const per = out.get(p.member)!;
    const cur = per.get(month) ?? { cents: 0, items: [] };
    cur.cents -= t.amount_cents;
    cur.items.push(t);
    per.set(month, cur);
  }
  return out;
}
