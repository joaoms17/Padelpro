// Annual activity (Joana) report — a yearly summary to help with taxes
// (secção 18). Pure and testable.

export interface YearPayment {
  amount_cents: number;
  received_at: string | null;
}
export interface YearEvent {
  date: string;
  status: string;
}
export interface YearExpense {
  category: string;
  amount_cents: number; // stored negative; we take the absolute
  date: string;
}

export interface YearReport {
  year: number;
  receitaCents: number;
  gastosCents: number;
  rentabilidadeCents: number;
  margem: number;
  nEventos: number;
  gastosPorCategoria: { categoria: string; cents: number }[];
  receitaPorMes: number[]; // 12 entries, cents
}

/** Amount to set aside for activity taxes (secção 18). rate is 0..1. */
export function taxReserve(rentabilidadeCents: number, rate: number): number {
  if (rate <= 0 || rentabilidadeCents <= 0) return 0;
  return Math.round(rentabilidadeCents * rate);
}

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isNaN(y) ? null : y;
}

export function activityYearReport(
  events: YearEvent[],
  payments: YearPayment[],
  expenses: YearExpense[],
  year: number,
): YearReport {
  const receitaPorMes = new Array(12).fill(0);
  let receita = 0;
  for (const p of payments) {
    if (yearOf(p.received_at) !== year) continue;
    receita += p.amount_cents;
    const m = Number(p.received_at!.slice(5, 7)) - 1;
    if (m >= 0 && m < 12) receitaPorMes[m] += p.amount_cents;
  }

  const byCat = new Map<string, number>();
  let gastos = 0;
  for (const e of expenses) {
    if (yearOf(e.date) !== year) continue;
    const abs = Math.abs(e.amount_cents);
    gastos += abs;
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + abs);
  }

  const nEventos = events.filter(
    (e) => yearOf(e.date) === year && e.status !== "cancelado",
  ).length;

  const rentabilidade = receita - gastos;
  return {
    year,
    receitaCents: receita,
    gastosCents: gastos,
    rentabilidadeCents: rentabilidade,
    margem: receita > 0 ? rentabilidade / receita : 0,
    nEventos,
    gastosPorCategoria: [...byCat.entries()]
      .map(([categoria, cents]) => ({ categoria, cents }))
      .sort((a, b) => b.cents - a.cents),
    receitaPorMes,
  };
}
