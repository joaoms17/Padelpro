import { describe, it, expect } from "vitest";
import { incomeMonths, joanaMonths } from "./conferir";
import type { ExpectedIncome } from "./forecast";

describe("joanaMonths", () => {
  it("compares Duet received vs bank per month, with a running gap", () => {
    const r = joanaMonths(
      ["2026-09", "2026-10"],
      [{ date: "2026-09-05", amount_cents: 30000 }, { date: "2026-10-02", amount_cents: 20000 }],
      [{ date: "2026-09-20", amount_cents: 25000 }, { date: "2026-10-03", amount_cents: 25000 }],
    );
    expect(r.map((m) => [m.diffCents, m.runningCents])).toEqual([[5000, 5000], [-5000, 0]]);
  });
});

describe("incomeMonths", () => {
  const sal: ExpectedIncome = {
    id: "s", household_id: "h", label: "Ordenado", amount_cents: 240000, parts: 1, day: 23,
    every_months: 1, anchor_month: "2026-01-01", match_text: "ntt data", active: true,
  };
  it("one salary in two months: the oldest month is covered, the other is missing", () => {
    const credits = [{ id: "1", booking_date: "2026-09-23", amount_cents: 240000, description_raw: "TRF NTT DATA" }];
    const r = incomeMonths([sal], credits, ["2026-08", "2026-09"], "2026-10-20").get("s")!;
    expect(r.map((m) => [m.month, m.receivedCents, m.missingCents])).toEqual([["2026-08", 240000, 0], ["2026-09", 0, 240000]]);
  });
  it("two transfers in August cover July and August (oldest first)", () => {
    const desp: ExpectedIncome = { ...sal, id: "d", label: "Despesas João", amount_cents: 54160, day: 5, match_text: "despesas" };
    const c = (id: string, d: string) => ({ id, booking_date: d, amount_cents: 54160, description_raw: "TRF DESPESAS JOAO" });
    const r = incomeMonths([sal, desp], [c("a", "2026-08-05"), c("b", "2026-08-28")], ["2026-07", "2026-08", "2026-09", "2026-10"], "2026-10-20").get("d")!;
    expect(r.map((m) => m.missingCents)).toEqual([0, 0, 54160, 54160]);
  });
  it("an early transfer covers the next month", () => {
    const c = [
      { id: "1", booking_date: "2026-09-23", amount_cents: 240000, description_raw: "TRF NTT DATA" },
      { id: "2", booking_date: "2026-09-29", amount_cents: 240000, description_raw: "TRF NTT DATA" },
    ];
    const r = incomeMonths([sal], c, ["2026-09", "2026-10"], "2026-10-20").get("s")!;
    expect(r.map((m) => m.missingCents)).toEqual([0, 0]);
  });
  it("a lower salary month is still ✓, with the real amount", () => {
    const c = [{ id: "1", booking_date: "2026-08-22", amount_cents: 210000, description_raw: "TRF NTT DATA" }];
    const r = incomeMonths([sal], c, ["2026-08"], "2026-10-20").get("s")!;
    expect(r[0]).toMatchObject({ receivedCents: 210000, missingCents: 0 });
  });
});
