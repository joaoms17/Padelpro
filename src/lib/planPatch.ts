// The plan's edits as small patches: only what changed on this phone is
// written, on top of the plan as the server has it at that moment, so what
// the other phone changed in the meantime stays. Also what "Pôr o plano em
// vigor" writes, and what it still has to apply once the plan is active.
// Pure and testable.
import { addMonth } from "./forecast";
import { formatEuros, monthName } from "./format";
import { JOANA_FROM } from "./month";
import { mesadaFor } from "./mesadas";
import type { MesadaMonth } from "@shared/engine/mesadas.ts";
import { normalizePlan, planMesada, type PlanSettings } from "./plan";
import { ofName } from "./planView";
import type { Member } from "./types";

type PerPerson = "mesadas" | "transition";
const PER_PERSON: PerPerson[] = ["mesadas", "transition"];

/** What changed: whole fields, except mesadas and transition, which go per person. */
export type PlanPatch = Partial<Omit<PlanSettings, PerPerson>> & Partial<Record<PerPerson, Record<string, number>>>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const isEmptyPatch = (p: PlanPatch) => Object.keys(p).length === 0;

/** The fields (and people) that differ from `prev` to `next`. */
export function planDiff(prev: PlanSettings, next: PlanSettings): PlanPatch {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof PlanSettings)[]) {
    if (k === "mesadas" || k === "transition") {
      const changed: Record<string, number> = {};
      for (const [id, v] of Object.entries(next[k])) if (prev[k][id] !== v) changed[id] = v;
      if (Object.keys(changed).length) out[k] = changed;
    } else if (!same(prev[k], next[k])) {
      out[k] = next[k];
    }
  }
  return out as PlanPatch;
}

/** Two patches in a row as one (the later one wins). */
export function mergePatch(a: PlanPatch, b: PlanPatch): PlanPatch {
  const out: PlanPatch = { ...a, ...b };
  for (const k of PER_PERSON) if (a[k] || b[k]) out[k] = { ...a[k], ...b[k] };
  return out;
}

/** A patch on top of a plan. */
export function applyPatch(plan: PlanSettings, patch: PlanPatch): PlanSettings {
  if (isEmptyPatch(patch)) return plan;
  const out = normalizePlan({ ...plan, ...patch });
  for (const k of PER_PERSON) out[k] = { ...plan[k], ...patch[k] };
  return out;
}

/** What "Pôr o plano em vigor" leaves in the plan: the values it applied, and active. */
export function appliedPatch(plan: PlanSettings, memberIds: string[]): PlanPatch {
  const pick = (r: Record<string, number>) => Object.fromEntries(memberIds.filter((id) => id in r).map((id) => [id, r[id]]));
  return {
    active: true,
    start_month: plan.start_month,
    mesada_day: plan.mesada_day,
    mesadas: pick(plan.mesadas),
    transition: pick(plan.transition),
  };
}

/**
 * The months "Pôr o plano em vigor" writes for each person (`current` is
 * today's month): `keep` keeps the value it had (before the transition, and
 * the plan's months already lived), `transition` gets the transition value,
 * and from `from` on the base value (the plan's mesada) applies.
 */
export function planMonths(firstMonth: string, current: string, startMonth: string): { keep: string[]; transition: string[]; from: string } {
  const from = current > startMonth ? current : startMonth;
  const isTransition = (m: string) => m >= JOANA_FROM && m < startMonth;
  const keep: string[] = [];
  for (let m = firstMonth; m < from && keep.length < 600; m = addMonth(m, 1)) if (!isTransition(m)) keep.push(m);
  const transition: string[] = [];
  for (let m = JOANA_FROM; m < startMonth && transition.length < 24; m = addMonth(m, 1)) transition.push(m);
  return { keep, transition, from };
}

/**
 * With the plan active: what was changed in it but is not applied yet (each
 * one's mesada and the transition months still to come, and the transfer
 * day). Este mês, the alerts and the mesada filing read the applied values,
 * so these only count after "Atualizar o plano".
 */
export function unappliedChanges(
  plan: PlanSettings,
  members: Pick<Member, "id" | "display_name" | "mesada_cents" | "mesada_day">[],
  overrides: MesadaMonth[],
  current: string,
): string[] {
  if (!plan.active) return [];
  const out: string[] = [];
  const from = current > plan.start_month ? current : plan.start_month;
  for (const m of members) {
    const who = ofName(m.display_name);
    let n = 0;
    for (let month = current > JOANA_FROM ? current : JOANA_FROM; month < plan.start_month && n < 24; month = addMonth(month, 1), n++) {
      const now = mesadaFor(m, month, overrides);
      const want = planMesada(plan, m.id, month);
      if (now !== want) out.push(`Mesada ${who} em ${monthName(month)} (transição): ${formatEuros(now)} → ${formatEuros(want)}`);
    }
    const now = mesadaFor(m, from, overrides);
    const want = planMesada(plan, m.id, from);
    if (now !== want) out.push(`Mesada ${who}: ${formatEuros(now)} → ${formatEuros(want)}`);
  }
  const other = members.find((m) => m.mesada_day !== plan.mesada_day);
  if (other) out.push(`Dia da transferência: ${other.mesada_day == null ? "—" : `dia ${other.mesada_day}`} → dia ${plan.mesada_day}`);
  return out;
}
