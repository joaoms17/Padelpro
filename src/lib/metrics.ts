// Metrics (spec 8) — pure and testable. All amounts integer cents, per civil
// month (Europe/Lisbon), excluding internal transfers and matched provisionals
// (the data layer applies those filters before calling here).

import type { CategoryGroup } from "./types";
import { paceProjection, daysInMonth } from "./budget";

export interface MetricTx {
  category_id: string | null;
  amount_cents: number;
}

export interface MonthTotals {
  entradasCents: number;
  despesasCasaCents: number; // fixas + variáveis + atividade
  mesadasCents: number;
  sobraCents: number; // entradas − despesas − mesadas
  taxaPoupanca: number; // sobra / entradas (0..1)
}

/** Core monthly P&L from categorized movements. */
export function monthTotals(
  txs: MetricTx[],
  group: Map<string, CategoryGroup>,
): MonthTotals {
  let entradas = 0;
  let despesas = 0;
  let mesadas = 0;
  for (const t of txs) {
    if (!t.category_id) continue;
    const g = group.get(t.category_id);
    if (!g || g === "interna") continue;
    if (g === "entrada") entradas += Math.max(0, t.amount_cents);
    else if (g === "mesada") mesadas += Math.abs(t.amount_cents);
    else if (g === "fixa" || g === "variavel" || g === "atividade")
      despesas += Math.abs(Math.min(0, t.amount_cents));
  }
  const sobra = entradas - despesas - mesadas;
  return {
    entradasCents: entradas,
    despesasCasaCents: despesas,
    mesadasCents: mesadas,
    sobraCents: sobra,
    taxaPoupanca: entradas > 0 ? sobra / entradas : 0,
  };
}

/** Base fixa (spec 2.4) must cover fixed charges + both mesadas. */
export function coberturaBaseFixa(
  baseFixaCents: number,
  fixasPrevistasCents: number,
  mesadasCents: number,
): number {
  const needed = fixasPrevistasCents + mesadasCents;
  return needed > 0 ? baseFixaCents / needed : 1;
}

export function comprometidoDia1(
  fixasPrevistasCents: number,
  mesadasCents: number,
  baseFixaCents: number,
): number {
  return baseFixaCents > 0 ? (fixasPrevistasCents + mesadasCents) / baseFixaCents : 0;
}

/** Commitments still to leave the account this month. */
export function compromissosPorSair(input: {
  fixasPorSairCents: number;
  mesadasPorSairCents: number;
  variaveisPorGastarCents: number; // only the positive part
}): number {
  return (
    Math.max(0, input.fixasPorSairCents) +
    Math.max(0, input.mesadasPorSairCents) +
    Math.max(0, input.variaveisPorGastarCents)
  );
}

export function almofadaDisponivel(
  balanceCents: number,
  compromissosPorSairCents: number,
): number {
  return balanceCents - compromissosPorSairCents;
}

export function almofadaMeses(
  almofadaCents: number,
  avgMonthlyDespesasMesadasCents: number,
): number {
  return avgMonthlyDespesasMesadasCents > 0
    ? almofadaCents / avgMonthlyDespesasMesadasCents
    : 0;
}

export function almofadaLivre(
  almofadaCents: number,
  reservadoObjetivosCents: number,
): number {
  return almofadaCents - reservadoObjetivosCents;
}

/** Projected end-of-month balance (spec 8). */
export function previsaoFimMes(input: {
  balanceCents: number;
  entradasEsperadasCents: number; // base fixa não recebida + eventos previstos
  fixasPorSairCents: number;
  mesadasPorSairCents: number;
  variaveisGastoCents: number; // spent so far this month
  month: string;
  today: string;
}): number {
  const dim = daysInMonth(input.month);
  const sameMonth = input.today.slice(0, 7) === input.month;
  const day = sameMonth ? Number(input.today.slice(8, 10)) : dim;
  const variaveisProjetadas = paceProjection(input.variaveisGastoCents, day, dim);
  const variaveisRestantes = Math.max(0, variaveisProjetadas - input.variaveisGastoCents);
  return (
    input.balanceCents +
    input.entradasEsperadasCents -
    Math.max(0, input.fixasPorSairCents) -
    Math.max(0, input.mesadasPorSairCents) -
    variaveisRestantes
  );
}

/** How much to set aside per month to reach a goal by its due date. */
export function goalMonthlyNeeded(
  targetCents: number,
  reservedCents: number,
  dueDate: string | null,
  today: string,
): number {
  const remaining = Math.max(0, targetCents - reservedCents);
  if (remaining === 0) return 0;
  if (!dueDate) return remaining;
  const months = monthsBetween(today, dueDate);
  if (months <= 0) return remaining;
  return Math.ceil(remaining / months);
}

function monthsBetween(fromISO: string, toISO: string): number {
  const [fy, fm] = fromISO.slice(0, 7).split("-").map(Number);
  const [ty, tm] = toISO.slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export const MESES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
