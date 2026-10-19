import { loadMonthTx, loadRecentTx } from "./budget";
import { listEvents, listPayments } from "./events";
import { listGoals } from "./goals";
import { recurringCandidates } from "@/lib/budget";
import {
  monthTotals,
  coberturaBaseFixa,
  comprometidoDia1,
  compromissosPorSair,
  almofadaDisponivel,
  almofadaMeses,
  almofadaLivre,
  previsaoFimMes,
  type MonthTotals,
} from "@/lib/metrics";
import { moneyOutsideHouse, aReceber, type Payment } from "@/lib/events";
import type { Category, Member } from "@/lib/types";
import type { CategoryGroup } from "@/lib/types";

export interface MetricsBundle {
  month: string;
  totals: MonthTotals;
  baseFixaCents: number;
  fixasPrevistasCents: number;
  mesadasTotalCents: number;
  cobertura: number;
  comprometido: number;
  almofadaDisponivelCents: number;
  almofadaMeses: number;
  almofadaLivreCents: number;
  previsaoCents: number;
  eventosForaCents: number;
  eventosAReceberCents: number;
  goalsReservedCents: number;
  monthlySeries: { month: string; entradas: number; despesas: number }[];
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export async function assembleMetrics(
  householdId: string,
  month: string,
  categories: Category[],
  members: Member[],
  balanceCents: number,
  today: string,
): Promise<MetricsBundle> {
  const group = new Map<string, CategoryGroup>(categories.map((c) => [c.id, c.grp]));
  const nameById = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));

  const [monthTx, recentTx, events] = await Promise.all([
    loadMonthTx(householdId, month),
    loadRecentTx(householdId, 400),
    listEvents(householdId),
  ]);
  const payments = await listPayments(events.map((e) => e.id));
  const goals = await listGoals(householdId);

  const totals = monthTotals(monthTx, group);

  // Base fixa = salário João + renda casa arrendada (most recent monthly value).
  const baseFixaCatIds = categories
    .filter((c) => c.grp === "entrada" && /sal[áa]rio|renda casa/.test(c.name.toLowerCase()))
    .map((c) => c.id);
  const baseFixaCents = latestMonthlyEntrada(recentTx, baseFixaCatIds, today);

  // Fixas previstas from recurring expenses; paid-so-far from this month's fixa txs.
  const fixasPrevistasCents = recurringCandidates(recentTx).reduce((a, r) => a + r.expectedCents, 0);
  const fixasPagasCents = sumGroupExpense(monthTx, group, "fixa");
  const fixasPorSair = Math.max(0, fixasPrevistasCents - fixasPagasCents);

  // Mesadas.
  const mesadasTotalCents = members.reduce((a, m) => a + (m.mesada_cents || 0), 0);
  const mesadasPagasCents = totals.mesadasCents;
  const mesadasPorSair = Math.max(0, mesadasTotalCents - mesadasPagasCents);

  // Variáveis budget vs spent.
  const variaveisOrcamento = categories
    .filter((c) => c.grp === "variavel")
    .reduce((a, c) => a + (c.budget_cents || 0), 0);
  const variaveisGasto = sumGroupExpense(monthTx, group, "variavel");
  const variaveisPorGastar = Math.max(0, variaveisOrcamento - variaveisGasto);

  const comp = compromissosPorSair({
    fixasPorSairCents: fixasPorSair,
    mesadasPorSairCents: mesadasPorSair,
    variaveisPorGastarCents: variaveisPorGastar,
  });
  const almofada = almofadaDisponivel(balanceCents, comp);

  // Average monthly (despesas + mesadas) over the previous 3 months.
  const avg3m = averageDespesasMesadas(recentTx, group, month, 3);

  const goalsReserved = goals.reduce((a, g) => a + (g.reserved_cents || 0), 0);

  // Entradas esperadas = base fixa ainda não recebida + eventos a receber este mês.
  const baseFixaRecebida = sumGroupEntrada(monthTx, nameById, group, baseFixaCatIds);
  const paymentsByEvent = new Map<string, Payment[]>();
  for (const p of payments) {
    const list = paymentsByEvent.get(p.event_id) ?? [];
    list.push(p);
    paymentsByEvent.set(p.event_id, list);
  }
  const eventosAReceber = aReceber(events, paymentsByEvent, today, 3);
  const entradasEsperadas = Math.max(0, baseFixaCents - baseFixaRecebida) + eventosAReceber;

  const previsao = previsaoFimMes({
    balanceCents,
    entradasEsperadasCents: entradasEsperadas,
    fixasPorSairCents: fixasPorSair,
    mesadasPorSairCents: mesadasPorSair,
    variaveisGastoCents: variaveisGasto,
    month,
    today,
  });

  // 12-month entradas vs despesas series.
  const monthlySeries = buildSeries(recentTx, group, month, 12);

  return {
    month,
    totals,
    baseFixaCents,
    fixasPrevistasCents,
    mesadasTotalCents,
    cobertura: coberturaBaseFixa(baseFixaCents, fixasPrevistasCents, mesadasTotalCents),
    comprometido: comprometidoDia1(fixasPrevistasCents, mesadasTotalCents, baseFixaCents),
    almofadaDisponivelCents: almofada,
    almofadaMeses: almofadaMeses(almofada, avg3m),
    almofadaLivreCents: almofadaLivre(almofada, goalsReserved),
    previsaoCents: previsao,
    eventosForaCents: moneyOutsideHouse(payments),
    eventosAReceberCents: eventosAReceber,
    goalsReservedCents: goalsReserved,
    monthlySeries,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

interface Tx {
  category_id: string | null;
  amount_cents: number;
  booking_date: string;
}

function sumGroupExpense(txs: Tx[], group: Map<string, CategoryGroup>, g: CategoryGroup): number {
  let s = 0;
  for (const t of txs) {
    if (t.category_id && group.get(t.category_id) === g) s += Math.abs(Math.min(0, t.amount_cents));
  }
  return s;
}

function sumGroupEntrada(
  txs: Tx[],
  _nameById: Map<string, string>,
  _group: Map<string, CategoryGroup>,
  catIds: string[],
): number {
  const set = new Set(catIds);
  let s = 0;
  for (const t of txs) if (t.category_id && set.has(t.category_id)) s += Math.max(0, t.amount_cents);
  return s;
}

function latestMonthlyEntrada(txs: Tx[], catIds: string[], today: string): number {
  const set = new Set(catIds);
  const byMonth = new Map<string, number>();
  for (const t of txs) {
    if (!t.category_id || !set.has(t.category_id)) continue;
    const mk = t.booking_date.slice(0, 7);
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + Math.max(0, t.amount_cents));
  }
  // most recent month that has a value (<= current month)
  const cur = today.slice(0, 7);
  const months = [...byMonth.keys()].filter((m) => m <= cur).sort();
  const last = months[months.length - 1];
  return last ? byMonth.get(last)! : 0;
}

function averageDespesasMesadas(
  txs: Tx[],
  group: Map<string, CategoryGroup>,
  month: string,
  n: number,
): number {
  let total = 0;
  let count = 0;
  for (let i = 1; i <= n; i++) {
    const mk = shiftMonth(month, -i);
    const slice = txs.filter((t) => t.booking_date.slice(0, 7) === mk);
    if (slice.length === 0) continue;
    const tt = monthTotals(slice, group);
    total += tt.despesasCasaCents + tt.mesadasCents;
    count++;
  }
  return count > 0 ? Math.round(total / count) : 0;
}

function buildSeries(
  txs: Tx[],
  group: Map<string, CategoryGroup>,
  month: string,
  n: number,
): { month: string; entradas: number; despesas: number }[] {
  const out: { month: string; entradas: number; despesas: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const mk = shiftMonth(month, -i);
    const slice = txs.filter((t) => t.booking_date.slice(0, 7) === mk);
    const tt = monthTotals(slice, group);
    out.push({ month: mk, entradas: tt.entradasCents, despesas: tt.despesasCasaCents + tt.mesadasCents });
  }
  return out;
}
