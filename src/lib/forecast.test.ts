import { describe, it, expect } from "vitest";
import {
  buildForecast,
  incomeStatus,
  isDueInMonth,
  matchingCredits,
  nextDueMonth,
  suggestIncomes,
  variaveisRestantes,
  type Credit,
  type ExpectedIncome,
} from "./forecast";

const income = (over: Partial<ExpectedIncome>): ExpectedIncome => ({
  id: "i1",
  household_id: "h",
  label: "Ordenado",
  amount_cents: 250000,
  parts: 1,
  day: 23,
  every_months: 1,
  anchor_month: "2026-09-01",
  match_text: "ntt data",
  active: true,
  ...over,
});
let n = 0;
const credit = (date: string, cents: number, desc = "TRF NTT DATA PORTUGAL SA"): Credit => ({
  id: `c${n++}`,
  booking_date: date,
  amount_cents: cents,
  description_raw: desc,
});

const salario = income({ id: "sal" });
const repres = income({ id: "rep", label: "Despesas de representação", amount_cents: 100000, parts: 2, day: 10, every_months: 2, anchor_month: "2026-08-01" });

describe("isDueInMonth / nextDueMonth", () => {
  it("every other month from the anchor, both ways", () => {
    expect(isDueInMonth(repres, "2026-10")).toBe(true);
    expect(isDueInMonth(repres, "2026-11")).toBe(false);
    expect(isDueInMonth(repres, "2026-06")).toBe(true);
    expect(nextDueMonth(repres, "2026-11")).toBe("2026-12");
    expect(isDueInMonth({ ...salario, active: false }, "2026-10")).toBe(false);
  });
});

describe("incomeStatus", () => {
  it("tells the salary and the 500 € transfers of the same payer apart", () => {
    const credits = [credit("2026-10-09", 50000), credit("2026-10-12", 1200, "MBWAY NTT DATA")];
    const [s, r] = incomeStatus([salario, repres], credits, "2026-10", "2026-10-20");
    expect(s).toMatchObject({ receivedCents: 0, pendingCents: 250000 });
    expect(r).toMatchObject({ receivedCents: 50000, pendingCents: 50000 });
  });
  it("nothing pending once everything arrived; a movement counts once", () => {
    const credits = [credit("2026-10-09", 50000), credit("2026-10-10", 50000), credit("2026-10-23", 251000)];
    const st = incomeStatus([salario, repres, { ...salario, id: "dup" }], credits, "2026-10", "2026-10-25");
    expect(st.map((x) => x.pendingCents)).toEqual([0, 0, 250000]);
  });
  it("salary paid with the subsídio (~2×) near its day is the salary, not counted twice", () => {
    const credits = [credit("2026-12-18", 475000)];
    const [s, r] = incomeStatus([salario, repres], credits, "2026-12", "2026-12-20");
    expect(s).toMatchObject({ receivedCents: 475000, pendingCents: 0 });
    expect(r).toMatchObject({ receivedCents: 0, pendingCents: 100000 });
  });
  it("a big movement far from the income's day does not count for it", () => {
    // Only the 500 € expenses (day 10) are set up; the salary on the 23rd is something else.
    const [r] = incomeStatus([repres], [credit("2026-10-23", 250000)], "2026-10", "2026-10-25");
    expect(r).toMatchObject({ receivedCents: 0, pendingCents: 100000 });
  });
  it("size-matching movements go first, so the expenses keep their 500 € transfers", () => {
    const credits = [credit("2026-10-09", 50000), credit("2026-10-10", 50000), credit("2026-10-22", 500000)];
    const [s, r] = incomeStatus([salario, repres], credits, "2026-10", "2026-10-25");
    expect(s.pendingCents).toBe(0);
    expect(r).toMatchObject({ receivedCents: 100000, pendingCents: 0 });
  });
  it("only incomes due this month; without keyword it counts as arrived after its day", () => {
    const noKw = income({ id: "renda", label: "Renda", amount_cents: 65000, day: 8, match_text: null });
    expect(incomeStatus([repres, noKw], [], "2026-11", "2026-11-05").map((x) => [x.income.id, x.pendingCents])).toEqual([["renda", 65000]]);
    expect(incomeStatus([noKw], [], "2026-11", "2026-11-09")[0]).toMatchObject({ pendingCents: 0, detectable: false });
  });
});

describe("matchingCredits", () => {
  it("previews size matches and a bigger one near the day", () => {
    const cs = [credit("2026-12-18", 475000), credit("2026-11-23", 250000), credit("2026-11-10", 50000)];
    expect(matchingCredits("NTT Data", 250000, 23, cs).map((c) => c.amount_cents)).toEqual([475000, 250000]);
    expect(matchingCredits("ntt data", 50000, 10, cs).map((c) => c.amount_cents)).toEqual([50000]);
  });
});

describe("suggestIncomes", () => {
  const history = [
    credit("2026-07-23", 248000),
    credit("2026-08-22", 251000),
    credit("2026-09-23", 250000),
    credit("2026-08-11", 50000),
    credit("2026-08-12", 50000),
    credit("2026-10-09", 50000),
    credit("2026-10-10", 50000),
    credit("2026-09-02", 9000, "CONTINENTE DEVOLUCAO"), // once: not regular
  ];
  it("finds the monthly salary and the 2 × 500 € every other month", () => {
    const s = suggestIncomes(history, [], "2026-10-20");
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ match_text: "ntt data", amount_cents: 250000, parts: 1, every_months: 1, day: 23, anchor_month: "2026-09-01" });
    expect(s[1]).toMatchObject({ match_text: "ntt data", amount_cents: 100000, parts: 2, every_months: 2, day: 10, anchor_month: "2026-10-01" });
  });
  it("skips what is already set up", () => {
    const s = suggestIncomes(history, [{ match_text: "NTT Data", amount_cents: 249000, parts: 1 }], "2026-10-20");
    expect(s.map((x) => x.parts)).toEqual([2]);
  });
});

describe("buildForecast", () => {
  it("balance + to receive − to pay − variable pace", () => {
    const f = buildForecast({
      balanceCents: 500000,
      incoming: [
        { key: "a", label: "Ordenado", cents: 250000 },
        { key: "b", label: "Nada", cents: 0 },
      ],
      fixasPorSairCents: 20000,
      mesadasPorSairCents: 30000,
      variaveisGastoCents: 20000,
      month: "2026-01",
      today: "2026-01-10",
    });
    expect(f.incoming.map((l) => l.key)).toEqual(["a"]);
    expect(variaveisRestantes(20000, "2026-01", "2026-01-10")).toBe(42000);
    expect(f.endCents).toBe(500000 + 250000 - 20000 - 30000 - 42000);
  });
});
