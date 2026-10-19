import { describe, it, expect } from "vitest";
import {
  spentByCategory,
  budgetLevel,
  paceProjection,
  daysInMonth,
  categoryProgress,
  recurringCandidates,
  fixedChanged,
  fixedOverdue,
  type MonthTx,
} from "./budget";

const tx = (over: Partial<MonthTx>): MonthTx => ({
  category_id: "c1",
  amount_cents: -1000,
  booking_date: "2026-01-05",
  counterparty: null,
  merchant_clean: "Continente",
  ...over,
});

describe("spentByCategory", () => {
  it("sums only the expense side per category", () => {
    const m = spentByCategory([
      tx({ category_id: "c1", amount_cents: -1000 }),
      tx({ category_id: "c1", amount_cents: -500 }),
      tx({ category_id: "c1", amount_cents: 2000 }), // entrada ignored
      tx({ category_id: "c2", amount_cents: -300 }),
      tx({ category_id: null, amount_cents: -999 }), // uncategorized ignored
    ]);
    expect(m.get("c1")).toBe(1500);
    expect(m.get("c2")).toBe(300);
  });
});

describe("budgetLevel", () => {
  it("flags 80% warn and 100% over", () => {
    expect(budgetLevel(700, 1000)).toBe("ok");
    expect(budgetLevel(800, 1000)).toBe("warn");
    expect(budgetLevel(1000, 1000)).toBe("over");
    expect(budgetLevel(500, null)).toBe("ok");
  });
});

describe("paceProjection", () => {
  it("projects month-end spend from the pace", () => {
    expect(paceProjection(1500, 10, 30)).toBe(4500);
    expect(daysInMonth("2026-02")).toBe(28);
  });
});

describe("categoryProgress", () => {
  it("marks paceOver when projection exceeds budget mid-month", () => {
    const p = categoryProgress("c1", 1500, 2000, "2026-01", "2026-01-10");
    expect(p.projectedCents).toBe(4650); // 1500/10*31
    expect(p.paceOver).toBe(true); // projected 46,50 € > 20 € budget
    expect(p.level).toBe("ok"); // spent 1500/2000 = 75% so far
  });
  it("a past month does not project beyond actual", () => {
    const p = categoryProgress("c1", 1500, 2000, "2026-01", "2026-03-10");
    expect(p.projectedCents).toBe(1500);
  });
});

describe("recurringCandidates", () => {
  it("detects a monthly fixed charge", () => {
    const txs: MonthTx[] = [
      tx({ counterparty: "EDP", amount_cents: -6200, booking_date: "2026-01-08" }),
      tx({ counterparty: "EDP", amount_cents: -6300, booking_date: "2026-02-08" }),
      tx({ counterparty: "EDP", amount_cents: -6250, booking_date: "2026-03-09" }),
    ];
    const r = recurringCandidates(txs);
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe("edp");
    expect(r[0].expectedCents).toBe(6250);
    expect(r[0].expectedDay).toBe(8);
    expect(r[0].occurrences).toBe(3);
  });

  it("ignores non-monthly cadence", () => {
    const txs: MonthTx[] = [
      tx({ counterparty: "X", amount_cents: -100, booking_date: "2026-01-01" }),
      tx({ counterparty: "X", amount_cents: -100, booking_date: "2026-01-05" }),
    ];
    expect(recurringCandidates(txs)).toHaveLength(0);
  });
});

describe("fixed alerts", () => {
  it("fixedChanged on >2% or >2€", () => {
    expect(fixedChanged(6200, 6250)).toBe(false); // 50c, <2% and <2€
    expect(fixedChanged(6200, 6500)).toBe(true); // 3€
    expect(fixedChanged(1000, 1025)).toBe(true); // 2.5%
  });
  it("fixedOverdue 5+ days past the usual day", () => {
    expect(fixedOverdue(8, "2026-01-14", false)).toBe(true);
    expect(fixedOverdue(8, "2026-01-12", false)).toBe(false);
    expect(fixedOverdue(8, "2026-01-20", true)).toBe(false); // already seen
  });
});
