// Events / activity (Joana) logic — pure and testable (spec 5).
// Amounts are integer cents.

export type EventStatus =
  | "pedido"
  | "confirmado"
  | "realizado"
  | "pago"
  | "cancelado";
// numerario/revolut: legacy values still allowed by the DB check; no longer offered (Santander only).
export type PaymentMethod = "transferencia" | "mbway" | "numerario" | "revolut";
export type PaymentKind = "sinal" | "restante" | "outro";

export interface EventRow {
  id: string;
  date: string; // ISO
  type: string;
  client_name: string | null;
  service_cents: number;
  expense_allowance_cents: number;
  expected_costs_cents: number;
  status: EventStatus;
}

export interface Payment {
  id: string;
  event_id: string;
  kind: PaymentKind;
  amount_cents: number;
  received_at: string | null;
  method: PaymentMethod | null;
}

/** What the client owes for an event: the service plus any expense allowance. */
export function eventDue(ev: EventRow): number {
  return ev.service_cents + ev.expense_allowance_cents;
}

export function eventPaid(payments: Payment[]): number {
  return payments.reduce((a, p) => a + p.amount_cents, 0);
}

export function eventOutstanding(ev: EventRow, payments: Payment[]): number {
  return Math.max(0, eventDue(ev) - eventPaid(payments));
}

export function isFullyPaid(ev: EventRow, payments: Payment[]): boolean {
  return eventDue(ev) > 0 && eventPaid(payments) >= eventDue(ev);
}

/** Suggest the next status: mark 'pago' once fully paid. */
export function suggestStatus(ev: EventRow, payments: Payment[]): EventStatus {
  if (ev.status === "cancelado") return "cancelado";
  if (isFullyPaid(ev, payments)) return "pago";
  return ev.status;
}

function inRange(iso: string | null, start: string, end: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= start && d < end;
}

export interface ActivityMetrics {
  receitaCents: number; // received in the period
  nEventos: number; // events dated in the period
  mediaEventoCents: number;
  gastosCents: number;
  rentabilidadeCents: number; // receita − gastos
  margem: number; // rentabilidade / receita (0..1)
}

/**
 * Activity metrics for a period. `receita` is money received (payments) in the
 * window; `gastos` is the activity expenses total (passed in, from the
 * "Atividade Joana" categories).
 */
export function activityMetrics(
  events: EventRow[],
  payments: Payment[],
  periodStart: string,
  periodEnd: string,
  gastosCents: number,
): ActivityMetrics {
  const receita = payments
    .filter((p) => inRange(p.received_at, periodStart, periodEnd))
    .reduce((a, p) => a + p.amount_cents, 0);
  const evs = events.filter(
    (e) => inRange(e.date, periodStart, periodEnd) && e.status !== "cancelado",
  );
  const n = evs.length;
  const rentabilidade = receita - gastosCents;
  return {
    receitaCents: receita,
    nEventos: n,
    mediaEventoCents: n > 0 ? Math.round(receita / n) : 0,
    gastosCents,
    rentabilidadeCents: rentabilidade,
    margem: receita > 0 ? rentabilidade / receita : 0,
  };
}

/** Still-to-receive from confirmed events dated within the next N months. */
export function aReceber(
  events: EventRow[],
  paymentsByEvent: Map<string, Payment[]>,
  today: string,
  months: number,
): number {
  const horizon = addMonths(today, months);
  let total = 0;
  for (const ev of events) {
    if (ev.status !== "confirmado" && ev.status !== "realizado") continue;
    const d = ev.date.slice(0, 10);
    if (d < today || d > horizon) continue;
    total += eventOutstanding(ev, paymentsByEvent.get(ev.id) ?? []);
  }
  return total;
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  return date.toISOString().slice(0, 10);
}
