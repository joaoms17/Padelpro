import { describe, expect, it } from "vitest";
import { balanceChange, balanceSeries, vocesSeries } from "./resumo";

const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
const end = new Map([
  ["2026-08", 300000],
  ["2026-09", 350000],
  ["2026-10", 500000],
  ["2026-11", 420000],
]);

describe("balanceSeries", () => {
  it("is empty without a known balance", () => {
    expect(balanceSeries(months, null, "2026-11")).toEqual([]);
  });
  it("keeps the last n months and calls the current one Hoje", () => {
    const s = balanceSeries(months, end, "2026-11", 3);
    expect(s.map((p) => p.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(s[2]).toMatchObject({ label: "Hoje", cents: 420000, current: true });
    expect(s[0].current).toBe(false);
  });
});

describe("balanceChange", () => {
  it("is today's balance against the end of last month", () => {
    expect(balanceChange(balanceSeries(months, end, "2026-11"))).toBe(-80000);
  });
  it("is null with a single month", () => {
    expect(balanceChange(balanceSeries(["2026-11"], end, "2026-11"))).toBeNull();
  });
});

describe("vocesSeries", () => {
  it("marks the months at 1 000 € or more", () => {
    const taken: Record<string, number> = { "2026-08": 95000, "2026-09": 100000, "2026-10": 120000, "2026-11": 40000 };
    const s = vocesSeries(months, (m) => taken[m], "2026-11");
    expect(s.map((p) => p.over)).toEqual([false, true, true, false]);
    expect(s[3].cents).toBe(40000);
  });
});
