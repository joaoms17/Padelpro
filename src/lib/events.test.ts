import { describe, it, expect } from "vitest";
import {
  eventDue,
  eventPaid,
  eventOutstanding,
  isFullyPaid,
  suggestStatus,
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

describe("acceptance: sinal MB Way + restante por transferência close the event", () => {
  it("a sinal plus a restante fully pay it", () => {
    const payments = [
      pay({ id: "s", kind: "sinal", amount_cents: 5000, method: "mbway" }),
      pay({ id: "r", kind: "restante", amount_cents: 15000, method: "transferencia" }),
    ];
    expect(isFullyPaid(ev({}), payments)).toBe(true);
    expect(suggestStatus(ev({ status: "realizado" }), payments)).toBe("pago");
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
