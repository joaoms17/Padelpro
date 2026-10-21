// "Sem categoria", one rule for every screen: a movement with no category of
// its own, Apple Pay notes aside (they wait for the bank's movement).
// Movimentos lists exactly these under "Por categorizar"; Meses and Este mês
// count the same ones, so a count and the list it links to always agree.
// Pure and testable.
import type { EngineTx } from "./month";
import { formatEuros } from "./format";

/** A movement nobody has filed yet (an Apple Pay note never is: it waits for the bank). */
export function isSemCategoria(t: Pick<EngineTx, "category_id" | "source">): boolean {
  return !t.category_id && t.source !== "applepay";
}

/** The movements without a category in a month (in every month when it is left out). */
export function semCategoria<T extends Pick<EngineTx, "booking_date" | "category_id" | "source">>(txs: T[], month?: string): T[] {
  return txs.filter((t) => isSemCategoria(t) && (month == null || t.booking_date.slice(0, 7) === month));
}

/** "1 movimento sem categoria" / "8 movimentos sem categoria". */
export function semCategoriaLabel(n: number): string {
  return `${n} ${n === 1 ? "movimento" : "movimentos"} sem categoria`;
}

/**
 * The Meses banner for a month's movements without a category: how many, how
 * much, and whether the totals can still change. `unknown` is how many of
 * them the app cannot place on its own; the others it already counts in the
 * right place (by an income's words or a person's name), so the totals don't
 * wait for them.
 */
export function semCategoriaBanner(n: number, cents: number, unknown: number): string {
  const head = `${semCategoriaLabel(n)} (${formatEuros(cents)}).`;
  if (unknown <= 0) {
    return n === 1
      ? `${head} Já conta nos totais (a app reconhece-o pela descrição) — categoriza-o para confirmar.`
      : `${head} Já contam nos totais (a app reconhece-os pela descrição) — categoriza-os para confirmar.`;
  }
  const pending = unknown === 1 ? "enquanto não for categorizado" : "enquanto não forem categorizados";
  if (unknown >= n) return `${head} ${pending.charAt(0).toUpperCase()}${pending.slice(1)}, os totais estão incompletos.`;
  return `${head} A app não sabe onde pôr ${unknown === 1 ? "um deles" : `${unknown} deles`}: ${pending}, os totais estão incompletos.`;
}
