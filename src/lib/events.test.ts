import { describe, it, expect } from "vitest";
import {
  eventDue,
  eventPaid,
  eventOutstanding,
  isFullyPaid,
  suggestStatus,
  moneyOutsideHouse,
  proposeSettlement,
  activityMetrics,
  aReceber,
  type EventRow,
  type Payment,
} from "./events";

const ev = (over: Partial<EventRow>): EventRow => ({
  id: "e1",
  date: "2026-05-10",
  type: "Noiva",
  client_name: "Maria",
  service_cents: 20000,
  expense_allowance_cents: 0,
  expected_costs_cents: 3000,
  status: "confirmado",
  ...over,
});

const pay = (over: Partial<Payment>): Payment => ({
  id: "p1",
  event_id: "e1",
  kind: "sinal",
  amount_cents: 5000,
  received_at: "2026-04-01",
  method: "mbway",
  location: "conta_casa",
  ...over,
});

describe("event totals", () => {
  it("due = service + expense allowance", () => {
    expect(eventDue(ev({ service_cents: 20000, expense_allowance_cents: 1500 }))).toBe(21500);
  });
  it("paid, outstanding, fully paid", () => {
    const payments = [pay({ amount_cents: 5000 }), pay({ id: "p2", kind: "restante", amount_cents: 15000 })];
    expect(eventPaid(payments)).toBe(20000);
    expect(eventOutstanding(ev({}), payments)).toBe(0);
    expect(isFullyPaid(ev({}), payments)).toBe(true);
  });
  it("suggests pago once fully paid", () => {
    expect(suggestStatus(ev({ status: "realizado" }), [pay({ amount_cents: 20000 })])).toBe("pago");
    expect(suggestStatus(ev({ status: "confirmado" }), [pay({ amount_cents: 5000 })])).toBe("confirmado");
  });
});

describe("acceptance: sinal MB Way + restante numerário close the event", () => {
  it("a sinal in conta_casa plus a restante por_transferir fully pay it", () => {
    const payments = [
      pay({ id: "s", kind: "sinal", amount_cents: 5000, method: "mbway", location: "conta_casa" }),
      pay({ id: "r", kind: "restante", amount_cents: 15000, method: "numerario", location: "por_transferir" }),
    ];
    expect(isFullyPaid(ev({}), payments)).toBe(true);
    expect(suggestStatus(ev({ status: "realizado" }), payments)).toBe("pago");
    expect(moneyOutsideHouse(payments)).toBe(15000); // the cash not yet deposited
  });
});

describe("proposeSettlement", () => {
  const payments = [
    pay({ id: "a", amount_cents: 5000, location: "por_transferir", received_at: "2026-04-01" }),
    pay({ id: "b", amount_cents: 15000, location: "por_transferir", received_at: "2026-04-10" }),
    pay({ id: "c", amount_cents: 3000, location: "conta_casa", received_at: "2026-04-05" }),
  ];
  it("matches a single payment exactly", () => {
    expect(proposeSettlement(payments, 15000).map((p) => p.id)).toEqual(["b"]);
  });
  it("accumulates oldest-first to the exact sum", () => {
    expect(proposeSettlement(payments, 20000).map((p) => p.id).sort()).toEqual(["a", "b"]);
  });
  it("returns nothing when no combination matches", () => {
    expect(proposeSettlement(payments, 9999)).toEqual([]);
  });
});

describe("activityMetrics", () => {
  it("computes receita, média, rentabilidade and margem", () => {
    const events = [ev({ id: "e1", date: "2026-05-10" }), ev({ id: "e2", date: "2026-05-20" })];
    const payments = [
      pay({ event_id: "e1", amount_cents: 20000, received_at: "2026-05-11" }),
      pay({ event_id: "e2", amount_cents: 10000, received_at: "2026-05-21" }),
    ];
    const m = activityMetrics(events, payments, "2026-05-01", "2026-06-01", 6000);
    expect(m.receitaCents).toBe(30000);
    expect(m.nEventos).toBe(2);
    expect(m.mediaEventoCents).toBe(15000);
    expect(m.rentabilidadeCents).toBe(24000);
    expect(m.margem).toBeCloseTo(0.8);
  });
});

describe("aReceber", () => {
  it("sums outstanding of confirmed events within the horizon", () => {
    const events = [
      ev({ id: "e1", date: "2026-06-01", status: "confirmado", service_cents: 20000 }),
      ev({ id: "e2", date: "2026-12-01", status: "confirmado", service_cents: 30000 }), // beyond 3m
    ];
    const byEv = new Map<string, Payment[]>([
      ["e1", [pay({ event_id: "e1", amount_cents: 5000 })]],
      ["e2", []],
    ]);
    expect(aReceber(events, byEv, "2026-05-15", 3)).toBe(15000); // only e1, 20000−5000
  });
});
