import { describe, it, expect } from "vitest";
import { ensaio, sustainableMesada, withMesada } from "./ensaio";
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
      mesadasFor: () => 60000,
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
      months: ["2026-08"], dataFrom: "2026-07-20", today: "2026-10-21", tx: [], group, joanaReceipts: [], mesadasFor: () => 0,
      incomeRows: [[{ month: "2026-08", due: true, expectedCents: 195157, receivedCents: 764388, missingCents: 0, noData: false, credits: [] }]],
    });
    expect(m.joaoCents).toBe(195157);
  });
  it("the first month (history from the 20th) and the current one are partial", () => {
    const r = ensaio({ months: ["2026-07", "2026-08", "2026-10"], dataFrom: "2026-07-20", today: "2026-10-21", tx: [], group, incomeRows: [], joanaReceipts: [], mesadasFor: () => 0 });
    expect(r.map((m) => m.partial)).toEqual([true, false, true]);
  });
});

describe("mesadas month by month", () => {
  const base = { dataFrom: "2026-07-01", today: "2026-12-15", tx: [], group, incomeRows: [] };
  const rows = ensaio({
    ...base,
    months: ["2026-09", "2026-10", "2026-12"],
    joanaReceipts: [
      { date: "2026-09-10", amount_cents: 200000 },
      { date: "2026-10-10", amount_cents: 300000 },
      { date: "2026-12-10", amount_cents: 999999 },
    ],
    mesadasFor: (m) => (m === "2026-10" ? 80000 : 60000),
  });
  it("uses each month's own mesadas", () => {
    expect(rows.map((r) => [r.mesadasCents, r.sobraCents])).toEqual([[60000, 140000], [80000, 220000], [60000, 939999]]);
  });
  it("sustainable mesada per person from full months only", () => {
    // full months: Sep (140000+60000) and Oct (220000+80000) → avg 250000 / 2 people
    expect(sustainableMesada(rows, 2)).toBe(125000);
  });
  it("simulator: the same mesada every month", () => {
    expect(withMesada(rows, 50000, 2).map((r) => r.sobraCents)).toEqual([100000, 200000, 899999]);
  });
});
