import { describe, it, expect } from "vitest";
import { buildICS } from "./ics";
import { activityYearReport } from "./activityYear";

describe("buildICS", () => {
  const ics = buildICS(
    [
      { id: "e1", date: "2026-05-10", type: "Noiva", client_name: "Maria, Silva", location: "Porto", notes: "Prova às 15h" },
      { id: "e2", date: "2026-06-01", type: "Concerto", client_name: null },
    ],
    "2026-01-01T00:00:00Z",
  );

  it("wraps events in a valid VCALENDAR", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });
  it("uses all-day dates and escapes text", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20260510");
    expect(ics).toContain("DTEND;VALUE=DATE:20260511");
    expect(ics).toContain("SUMMARY:Maria\\, Silva · Noiva");
  });
  it("uses CRLF line endings", () => {
    expect(ics.includes("\r\n")).toBe(true);
  });
});

describe("activityYearReport", () => {
  const events = [
    { date: "2026-05-10", status: "pago" },
    { date: "2026-07-02", status: "confirmado" },
    { date: "2026-08-01", status: "cancelado" },
    { date: "2025-05-10", status: "pago" }, // other year
  ];
  const payments = [
    { amount_cents: 20000, received_at: "2026-05-11" },
    { amount_cents: 5000, received_at: "2026-07-02" },
    { amount_cents: 9999, received_at: "2025-12-01" }, // other year
  ];
  const expenses = [
    { category: "Material", amount_cents: -3000, date: "2026-05-01" },
    { category: "Deslocações", amount_cents: -1500, date: "2026-07-01" },
    { category: "Material", amount_cents: -1000, date: "2026-07-05" },
  ];

  it("aggregates the year's receita, gastos and margem", () => {
    const r = activityYearReport(events, payments, expenses, 2026);
    expect(r.receitaCents).toBe(25000);
    expect(r.gastosCents).toBe(5500);
    expect(r.rentabilidadeCents).toBe(19500);
    expect(r.margem).toBeCloseTo(0.78);
    expect(r.nEventos).toBe(2); // cancelado excluded, other year excluded
  });
  it("breaks expenses down by category, largest first", () => {
    const r = activityYearReport(events, payments, expenses, 2026);
    expect(r.gastosPorCategoria[0]).toEqual({ categoria: "Material", cents: 4000 });
    expect(r.gastosPorCategoria[1]).toEqual({ categoria: "Deslocações", cents: 1500 });
  });
  it("puts receita in the right month buckets", () => {
    const r = activityYearReport(events, payments, expenses, 2026);
    expect(r.receitaPorMes[4]).toBe(20000); // May
    expect(r.receitaPorMes[6]).toBe(5000); // July
  });
});
