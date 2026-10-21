// "Ensaio das mesadas": each month as if every income had come into the
// house account and only the agreed mesadas had gone out. Pure and testable.
import type { CategoryGroup } from "./types";
import type { IncomeMonth } from "./conferir";

export interface EnsaioMonth {
  month: string;
  /** Bank data only covers part of it (history starts, or the month is not over). */
  partial: boolean;
  /** João's expected incomes: what arrived, or the expected value if it didn't. */
  joaoCents: number;
  /** Joana: what she marked as received in the App1. */
  joanaCents: number;
  /** Real house spending: fixas, variáveis, atividade (net of refunds). */
  despesasCents: number;
  /** The agreed mesadas of both. */
  mesadasCents: number;
  /** Real mesadas, personal withdrawals and transfers out — replaced by the agreed mesadas. */
  retiradasCents: number;
  /** Money out with no category: not counted until categorized. */
  semCategoriaCents: number;
  sobraCents: number;
}

export interface EnsaioTx {
  category_id: string | null;
  amount_cents: number;
  booking_date: string;
}

const HOUSE: CategoryGroup[] = ["fixa", "variavel", "atividade"];

export function ensaio(input: {
  months: string[];
  /** First day with bank data (YYYY-MM-DD). */
  dataFrom: string;
  today: string;
  tx: EnsaioTx[];
  group: Map<string, CategoryGroup>;
  incomeRows: IncomeMonth[][];
  joanaReceipts: { date: string; amount_cents: number }[];
  mesadasCents: number;
}): EnsaioMonth[] {
  return input.months.map((month) => {
    const partial = input.dataFrom.slice(0, 7) === month && input.dataFrom.slice(8, 10) !== "01"
      ? true
      : input.today.slice(0, 7) === month;
    let despesas = 0;
    let retiradas = 0;
    let semCategoria = 0;
    for (const t of input.tx) {
      if (t.booking_date.slice(0, 7) !== month) continue;
      const g = t.category_id ? input.group.get(t.category_id) : undefined;
      if (g && HOUSE.includes(g)) despesas -= t.amount_cents;
      else if (t.amount_cents < 0 && (g === "mesada" || g === "interna")) retiradas -= t.amount_cents;
      else if (t.amount_cents < 0 && !g) semCategoria -= t.amount_cents;
    }
    let joao = 0;
    for (const rows of input.incomeRows) {
      const r = rows.find((x) => x.month === month);
      if (!r || r.noData) continue;
      joao += r.due ? Math.max(r.receivedCents, r.expectedCents) : r.receivedCents;
    }
    const joana = input.joanaReceipts
      .filter((r) => r.date.slice(0, 7) === month)
      .reduce((a, r) => a + r.amount_cents, 0);
    const sobra = joao + joana - despesas - input.mesadasCents;
    return {
      month,
      partial,
      joaoCents: joao,
      joanaCents: joana,
      despesasCents: despesas,
      mesadasCents: input.mesadasCents,
      retiradasCents: retiradas,
      semCategoriaCents: semCategoria,
      sobraCents: sobra,
    };
  });
}
