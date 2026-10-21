import { describe, it, expect } from "vitest";
import {
  bookedMonths,
  byProject,
  joanaMonthRows,
  joanaNow,
  joanaStats,
  joanaTransfers,
  joanaUnclassified,
  monthGap,
  NO_PROJECT,
  pct,
  rangeLabel,
  receiptsByMonth,
  type Receipt,
} from "./joanaView";
import { duetHistory } from "./planView";
import { joanaHistory } from "./plan";
import { monthBreakdown, type EngineCtx, type EngineTx } from "./month";

const r = (date: string, euros: number, title = "Evento", project: string | null = "Cabelos"): Receipt => ({
  date,
  amount_cents: Math.round(euros * 100),
  title,
  project,
});

// Current month: October 2026. The last 12 complete months: Oct 2025 – Sep 2026.
const receipts: Receipt[] = [
  r("2025-09-20", 999, "Fora da janela"),
  r("2026-01-10", 400, "Casamento Ana"),
  r("2026-01-25", 200, "Ensaio", null),
  // February and March: nothing (count as 0 after the first month).
  r("2026-04-05", 900, "Concerto", "Música"),
  r("2026-05-02", 300),
  r("2026-06-14", 600, "Festival", "Música"),
  r("2026-07-01", 300),
  r("2026-08-09", 1200, "Casamento Rita"),
  r("2026-09-12", 800, "Concerto", "Música"),
  r("2026-09-03", 100, "Sinal", "  "),
  // The month running never counts in the numbers.
  r("2026-10-04", 500, "Agora"),
];

describe("grouping by month", () => {
  it("sums each month, newest receipt first", () => {
    const by = receiptsByMonth(receipts);
    expect(by.get("2026-01")).toMatchObject({ cents: 60000, count: 2 });
    expect(by.get("2026-09")!.receipts.map((x) => x.date)).toEqual(["2026-09-12", "2026-09-03"]);
    expect(by.has("2026-02")).toBe(false);
    expect(receiptsByMonth([]).size).toBe(0);
  });
});

describe("stats over the complete months", () => {
  const s = joanaStats(receipts, "2026-10");

  it("from the first month with money, never the current one, at most 12", () => {
    expect(s.months).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(s.total).toBe(480000);
  });

  it("the average is the plan's (joanaHistory over the same months)", () => {
    const plan = joanaHistory([], duetHistory(receipts, "2026-10"), "2026-10");
    expect(s.average).toBe(plan.average);
    expect(s.average).toBe(Math.round(480000 / 9));
    expect(s.weakest!.cents).toBe(plan.weakest);
  });

  it("median, best and weakest (the oldest when tied)", () => {
    // 600, 0, 0, 900, 300, 600, 300, 1200, 900 → sorted middle: 600.
    expect(s.median).toBe(60000);
    expect(s.best).toEqual({ month: "2026-08", cents: 120000 });
    expect(s.weakest).toEqual({ month: "2026-02", cents: 0 });
    const odd = joanaStats([r("2026-07-01", 100), r("2026-08-01", 200), r("2026-09-01", 400)], "2026-10");
    expect(odd.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(odd.median).toBe(20000);
    // An even count: the middle two averaged.
    const two = joanaStats([r("2026-08-01", 100), r("2026-09-01", 250)], "2026-10");
    expect(two.median).toBe(17500);
  });

  it("a month 12 back still counts, 13 back does not", () => {
    const x = joanaStats([r("2025-10-01", 100), r("2025-09-30", 50), r("2026-09-01", 200)], "2026-10");
    expect(x.months[0]).toBe("2025-10");
    expect(x.months).toHaveLength(12);
    expect(x.total).toBe(30000);
  });

  it("nothing received: no numbers", () => {
    const none = joanaStats([r("2026-10-02", 300)], "2026-10");
    expect(none).toEqual({ months: [], average: null, median: null, best: null, weakest: null, total: 0 });
  });

  it("range labels", () => {
    expect(rangeLabel(s.months)).toBe("de janeiro a setembro de 2026");
    expect(rangeLabel(["2025-10", "2026-09"])).toBe("de outubro de 2025 a setembro de 2026");
    expect(rangeLabel(["2026-09"])).toBe("setembro de 2026");
    expect(rangeLabel([])).toBe("");
  });
});

describe("month by month", () => {
  it("newest first, the bar against the best month, the account where the bank has data", () => {
    const rows = joanaMonthRows(receipts, "2026-10", { "2026-08": 100000, "2026-09": 0 });
    expect(rows.map((x) => x.month)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01"]);
    expect(rows[0]).toMatchObject({ cents: 90000, count: 2, ratio: 0.75, bank: 0 });
    expect(rows[1]).toMatchObject({ cents: 120000, ratio: 1, bank: 100000 });
    expect(rows[2].bank).toBeNull();
    // Before November it is not a debt: no gap at all.
    expect(rows[0].gap).toBeNull();
    expect(rows.find((x) => x.month === "2026-02")).toMatchObject({ cents: 0, count: 0, receipts: [], ratio: 0 });
  });

  it("from November the difference is still to arrive, unless marked as not owed", () => {
    const later = [r("2026-11-05", 1000), r("2026-12-05", 1500), r("2027-01-10", 800), r("2027-01-20", 200)];
    const rows = joanaMonthRows(later, "2027-02", { "2026-11": 100000, "2026-12": 120000, "2027-01": 70000 }, { "2027-01": 30000 });
    const of = (m: string) => rows.find((x) => x.month === m)!;
    expect(of("2026-11").gap).toEqual({ gap: 0, waived: 0, missing: 0 });
    expect(of("2026-12").gap).toEqual({ gap: 30000, waived: 0, missing: 30000 });
    expect(of("2027-01").gap).toEqual({ gap: 30000, waived: 30000, missing: 0 });
    expect(monthGap("2026-12", 150000, null)).toBeNull();
    expect(monthGap("2026-10", 150000, 0)).toBeNull();
  });
});

describe("the month running", () => {
  const events = [
    { date: "2026-10-03", value_cents: 50000, missing_cents: 0 },
    { date: "2026-10-18", value_cents: 80000, missing_cents: 30000 },
    { date: "2026-10-30", value_cents: 60000, missing_cents: 60000 },
    { date: "2026-11-02", value_cents: 90000, missing_cents: 90000 },
  ];
  it("received so far and what is still to receive on Duet this month", () => {
    const now = joanaNow(receipts, events, "2026-10", 100000);
    expect(now).toMatchObject({ month: "2026-10", cents: 50000, count: 1, toReceive: 90000, pending: 2, bank: 100000, gap: null });
  });
  it("from November what reached the account is checked", () => {
    const now = joanaNow([r("2026-11-03", 900)], events, "2026-11", 50000, 10000);
    expect(now.toReceive).toBe(90000);
    expect(now.gap).toEqual({ gap: 40000, waived: 10000, missing: 30000 });
    expect(joanaNow([], [], "2026-11", null).gap).toBeNull();
  });
});

describe("coming months", () => {
  it("six months of what is already booked (the events' values)", () => {
    const events = [
      { date: "2026-10-30", value_cents: 60000, missing_cents: 60000 },
      { date: "2026-11-02", value_cents: 90000, missing_cents: 90000 },
      { date: "2026-11-20", value_cents: 30000, missing_cents: 0 },
      { date: "2027-01-15", value_cents: 0, missing_cents: 0 },
      { date: "2027-04-01", value_cents: 120000, missing_cents: 120000 },
      { date: "2027-05-01", value_cents: 50000, missing_cents: 50000 },
    ];
    expect(bookedMonths(events, "2026-10")).toEqual([
      { month: "2026-11", cents: 120000, count: 2 },
      { month: "2026-12", cents: 0, count: 0 },
      { month: "2027-01", cents: 0, count: 1 },
      { month: "2027-02", cents: 0, count: 0 },
      { month: "2027-03", cents: 0, count: 0 },
      { month: "2027-04", cents: 120000, count: 1 },
    ]);
  });
});

describe("per project", () => {
  it("over the given months, without a project as 'Sem projeto', biggest first", () => {
    const s = joanaStats(receipts, "2026-10");
    const p = byProject(receipts, s.months);
    expect(p.map((x) => x.project)).toEqual(["Música", "Cabelos", NO_PROJECT]);
    expect(p[0]).toMatchObject({ cents: 230000, count: 3 });
    expect(p[1]).toMatchObject({ cents: 220000, count: 4 });
    expect(p[2]).toMatchObject({ cents: 30000, count: 2 });
    expect(p.reduce((a, x) => a + x.cents, 0)).toBe(s.total);
    expect(p.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
    expect(pct(p[0].share)).toBe("48%");
    expect(pct(p[1].share)).toBe("46%");
    expect(byProject(receipts, [])).toEqual([]);
  });
});

// ── What reached the account ────────────────────────────────────────────────

const cat = (id: string, grp: string, name: string, system_role: string | null = null) =>
  ({ id, grp, name, system_role, archived: false, merged_into: null, sort: 0, budget_cents: null }) as EngineCtx["categories"][number];
const ctx: EngineCtx = {
  categories: [cat("ren", "entrada", "Renda casa arrendada", "renda"), cat("ev", "entrada", "Eventos Joana", "eventos"), cat("sup", "variavel", "Supermercado")],
  members: [
    { id: "mj", display_name: "João" },
    { id: "ma", display_name: "Joana" },
  ],
  incomes: [
    { id: "i3", household_id: "h", label: "Renda Casa", amount_cents: 120000, parts: 1, day: 8, every_months: 1, anchor_month: "2026-07-01", match_text: "renda", active: true, kind: "renda" },
  ] as EngineCtx["incomes"],
  today: "2026-10-21",
  firstDataDate: "2026-08-01",
};
let n = 0;
const t = (date: string, cents: number, desc: string, category_id: string | null = null, over: Partial<EngineTx> = {}): EngineTx => ({
  id: `t${n++}`, booking_date: date, amount_cents: cents, description_raw: desc, category_id, source: "banco", pontual: false, ...over,
});
const txs: EngineTx[] = [
  t("2026-08-20", 100000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672"),
  t("2026-09-15", 150000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672", "ev"),
  t("2026-09-27", -30000, "MB WAY P/ JOANA CARNEIRO"),
  t("2026-10-06", 50000, "TRF.IMED. DE JOANA CARNEIRO MORAES-R09668271"),
  t("2026-10-09", 50000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672"),
  // Names Joana, but matches the rent: the engine files it as the rent.
  t("2026-10-08", 120000, "TRF CRED SEPA+ DE JOANA CARNEIRO RENDA"),
  t("2026-10-10", -5000, "COMPRA CONTINENTE", "sup"),
];

describe("her transfers into the account", () => {
  const breakdowns = ["2026-08", "2026-09", "2026-10"].map((m) => monthBreakdown(txs, ctx, m));
  const months = joanaTransfers(breakdowns, txs);

  it("the engine's Joana line per month, newest first, with a clean name", () => {
    expect(months.map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(months[0].cents).toBe(100000);
    expect(months[0].transfers.map((x) => x.date)).toEqual(["2026-10-09", "2026-10-06"]);
    expect(months[0].transfers[0].title).toBe("Joana Carneiro Moraes");
    expect(months[1].transfers).toHaveLength(1);
    expect(months[1].transfers[0]).toMatchObject({ date: "2026-09-15", cents: 150000 });
    // The same numbers as the engine's line.
    for (const m of months) expect(m.transfers.reduce((a, x) => a + x.cents, 0)).toBe(m.cents);
  });

  it("flags money in naming Joana that the engine does not count as hers", () => {
    const odd = joanaUnclassified(txs, ctx);
    expect(odd.map((x) => x.description_raw)).toEqual(["TRF CRED SEPA+ DE JOANA CARNEIRO RENDA"]);
    expect(joanaUnclassified(txs, ctx, "2026-11-01")).toEqual([]);
    expect(joanaUnclassified(txs, { ...ctx, members: [ctx.members[0]] })).toEqual([]);
  });
});
