// "Ensaio das mesadas": each month as if every income had come into the
// house account and only the agreed mesadas had gone out. Pure and testable.
import type { CategoryGroup } from "./types";
import type { IncomeMonth } from "./conferir";

export interface EnsaioMonth {
  month: string;
  /** Bank data only covers part of it (history starts, or the month is not over). */
  partial: boolean;
  /** João's expected incomes: what really arrived (prémios included), or the expected value if nothing did. */
  joaoCents: number;
  /** Joana: what she marked as received in the App1. */
  joanaCents: number;
  /** Real house spending: fixas, variáveis, atividade (net of refunds). */
  despesasCents: number;
  /** The agreed mesadas of both, for this month. */
  mesadasCents: number;
  /** Real mesadas, personal withdrawals and transfers out — replaced by the agreed mesadas. */
  retiradasCents: number;
  /** Of which, paid in the mesada categories. */
  mesadasPagasCents: number;
  /** What was left after the house and what you really took: could have gone to the mesadas too. */
  podiaMaisCents: number;
  /** Money out with no category: not counted until categorized. */
  semCategoriaCents: number;
  sobraCents: number;
}

export interface EnsaioTx {
  category_id: string | null;
  amount_cents: number;
  booking_date: string;
  description_raw?: string | null;
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
  /** Total agreed mesadas for a month (they can change month to month). */
  mesadasFor: (month: string) => number;
  /** Money out that went to one of you (default: mesada and "between accounts" categories). */
  isPaidOut?: (t: EnsaioTx) => boolean;
}): EnsaioMonth[] {
  const paidOut =
    input.isPaidOut ??
    ((t: EnsaioTx) => {
      const g = t.category_id ? input.group.get(t.category_id) : undefined;
      return t.amount_cents < 0 && (g === "mesada" || g === "interna");
    });
  return input.months.map((month) => {
    const partial = input.dataFrom.slice(0, 7) === month && input.dataFrom.slice(8, 10) !== "01"
      ? true
      : input.today.slice(0, 7) === month;
    let despesas = 0;
    let retiradas = 0;
    let mesadasPagas = 0;
    let semCategoria = 0;
    for (const t of input.tx) {
      if (t.booking_date.slice(0, 7) !== month) continue;
      const g = t.category_id ? input.group.get(t.category_id) : undefined;
      if (g && HOUSE.includes(g)) despesas -= t.amount_cents;
      else if (paidOut(t)) {
        retiradas -= t.amount_cents;
        if (g === "mesada") mesadasPagas -= t.amount_cents;
      } else if (t.amount_cents < 0 && !g) semCategoria -= t.amount_cents;
    }
    let joao = 0;
    for (const rows of input.incomeRows) {
      const r = rows.find((x) => x.month === month);
      if (!r || r.noData) continue;
      // What really came in (a prémio too — when passed on to João it shows up
      // as paid to him); the expected value when nothing arrived.
      joao += r.due ? Math.max(r.receivedCents, r.expectedCents) : r.receivedCents;
    }
    const joana = input.joanaReceipts
      .filter((r) => r.date.slice(0, 7) === month)
      .reduce((a, r) => a + r.amount_cents, 0);
    const mesadas = input.mesadasFor(month);
    const sobra = joao + joana - despesas - mesadas;
    return {
      month,
      partial,
      joaoCents: joao,
      joanaCents: joana,
      despesasCents: despesas,
      mesadasCents: mesadas,
      retiradasCents: retiradas,
      mesadasPagasCents: mesadasPagas,
      podiaMaisCents: joao + joana - despesas - retiradas,
      semCategoriaCents: semCategoria,
      sobraCents: sobra,
    };
  });
}

/** Months the bank covers fully (the average uses only these). */
export const fullMonths = (rows: EnsaioMonth[]) => rows.filter((r) => !r.partial);

/**
 * The highest mesada per person that would have closed the average full
 * month at zero: (average sobra + average mesadas) / number of people.
 */
export function sustainableMesada(rows: EnsaioMonth[], people: number): number | null {
  const full = fullMonths(rows);
  if (!full.length || people <= 0) return null;
  const avg = full.reduce((a, r) => a + r.sobraCents + r.mesadasCents, 0) / full.length;
  return Math.floor(avg / people);
}

/** The months again, with every mesada set to `perPerson` (the simulator). */
export function withMesada(rows: EnsaioMonth[], perPerson: number, people: number): EnsaioMonth[] {
  return rows.map((r) => {
    const mesadas = perPerson * people;
    return { ...r, mesadasCents: mesadas, sobraCents: r.sobraCents + r.mesadasCents - mesadas };
  });
}
