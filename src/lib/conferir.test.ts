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
  it("expected vs received each month", () => {
    const credits = [{ id: "1", booking_date: "2026-09-23", amount_cents: 240000, description_raw: "TRF NTT DATA" }];
    const r = incomeMonths([sal], credits, ["2026-08", "2026-09"], "2026-10-20").get("s")!;
    expect(r.map((m) => [m.month, m.receivedCents, m.missingCents])).toEqual([["2026-08", 0, 240000], ["2026-09", 240000, 0]]);
  });
});
