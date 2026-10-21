import { describe, it, expect } from "vitest";
import { ensaio } from "./ensaio";
import type { CategoryGroup } from "./types";

const group = new Map<string, CategoryGroup>([
  ["sup", "variavel"], ["luz", "fixa"], ["mes", "mesada"], ["int", "interna"], ["sal", "entrada"],
]);
const tx = (category_id: string | null, amount_cents: number, booking_date = "2026-09-10") => ({ category_id, amount_cents, booking_date });

describe("ensaio", () => {
  it("all incomes in, only agreed mesadas out; real withdrawals set aside", () => {
    const [m] = ensaio({
      months: ["2026-09"],
      dataFrom: "2026-07-20",
      today: "2026-10-21",
      tx: [tx("sup", -40000), tx("sup", 5000), tx("luz", -6000), tx("mes", -30000), tx("int", -50000), tx(null, -1200), tx("sal", 240000)],
      group,
      incomeRows: [[{ month: "2026-09", due: true, expectedCents: 240000, receivedCents: 0, missingCents: 240000, noData: false, credits: [] }]],
      joanaReceipts: [{ date: "2026-09-05", amount_cents: 80000 }, { date: "2026-08-05", amount_cents: 999 }],
      mesadasCents: 60000,
    });
    expect(m).toMatchObject({
      partial: false,
      joaoCents: 240000,
      joanaCents: 80000,
      despesasCents: 41000,
      retiradasCents: 80000,
      semCategoriaCents: 1200,
      sobraCents: 240000 + 80000 - 41000 - 60000,
    });
  });
  it("João counts at the normal salary, ignoring a prémio paid with it", () => {
    const [m] = ensaio({
      months: ["2026-08"], dataFrom: "2026-07-20", today: "2026-10-21", tx: [], group, joanaReceipts: [], mesadasCents: 0,
      incomeRows: [[{ month: "2026-08", due: true, expectedCents: 195157, receivedCents: 764388, missingCents: 0, noData: false, credits: [] }]],
    });
    expect(m.joaoCents).toBe(195157);
  });
  it("the first month (history from the 20th) and the current one are partial", () => {
    const r = ensaio({ months: ["2026-07", "2026-08", "2026-10"], dataFrom: "2026-07-20", today: "2026-10-21", tx: [], group, incomeRows: [], joanaReceipts: [], mesadasCents: 0 });
    expect(r.map((m) => m.partial)).toEqual([true, false, true]);
  });
});
