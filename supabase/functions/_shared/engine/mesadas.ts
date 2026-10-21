// Mesadas month by month: the agreed value per person. Pure and testable;
// shared by the app (src/lib/mesadas.ts) and the Edge Functions.
import type { Member } from "./types.ts";

/** A mesada set for one month (mesada_months, migration 0014). */
export interface MesadaMonth {
  member_id: string;
  month: string; // YYYY-MM-01
  amount_cents: number;
}

/** A person's mesada in a month: the value set for that month, else the base. */
export function mesadaFor(member: Pick<Member, "id" | "mesada_cents">, month: string, overrides: MesadaMonth[]): number {
  const o = overrides.find((x) => x.member_id === member.id && x.month.slice(0, 7) === month);
  return o ? o.amount_cents : member.mesada_cents || 0;
}

export function isOverride(memberId: string, month: string, overrides: MesadaMonth[]): boolean {
  return overrides.some((x) => x.member_id === memberId && x.month.slice(0, 7) === month);
}
