// Joana's events from the "Duet — Gigs & Brides" app (its own Supabase
// project). Same rules as Duet's src/selectors.js: `value` is the final
// amount she receives; what was received is the sum of the payments, or —
// for old events without payments — the whole value when flagged `paid`.

export interface DuetEventRow {
  id: string;
  project_id: string | null;
  title: string | null;
  event_date: string;
  start_time?: string | null;
  value: number | string | null;
  paid?: boolean | null;
  paid_at?: string | null;
  zero_confirmed?: boolean | null;
}
export interface DuetPaymentRow {
  event_id: string;
  paid_at: string | null;
  amount: number | string | null;
}
export interface DuetProjectRow {
  id: string;
  name: string | null;
  kind?: string | null;
  color?: string | null;
}

export type DuetState = "novalue" | "zero" | "paid" | "partial" | "due" | "overdue";

/** What the app gets back: only what the forecast and the lists need. */
export interface DuetEvent {
  id: string;
  date: string;
  time: string | null;
  title: string;
  project: string | null;
  kind: string | null;
  color: string | null;
  value_cents: number;
  received_cents: number;
  missing_cents: number;
  state: DuetState;
}

const cents = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100) || 0;

export function toDuetEvents(
  events: DuetEventRow[],
  payments: DuetPaymentRow[],
  projects: DuetProjectRow[],
  today: string,
): DuetEvent[] {
  const byEvent = new Map<string, DuetPaymentRow[]>();
  for (const p of payments) byEvent.set(p.event_id, [...(byEvent.get(p.event_id) ?? []), p]);
  const project = new Map(projects.map((p) => [p.id, p]));

  return events.map((e) => {
    const value = cents(e.value);
    const ps = byEvent.get(e.id) ?? [];
    const received = ps.length ? ps.reduce((a, p) => a + cents(p.amount), 0) : e.paid ? value : 0;
    const missing = Math.max(0, value - received);
    let state: DuetState;
    if (value <= 0 && !e.paid && !ps.length) state = e.zero_confirmed ? "zero" : "novalue";
    else if (missing === 0) state = "paid";
    else if (received > 0) state = "partial";
    else state = e.event_date < today ? "overdue" : "due";
    const p = e.project_id ? project.get(e.project_id) : undefined;
    return {
      id: e.id,
      date: e.event_date,
      time: e.start_time ? String(e.start_time).slice(0, 5) : null,
      title: (e.title ?? "").trim() || "Evento",
      project: p?.name ?? null,
      kind: p?.kind ?? null,
      color: p?.color ?? null,
      value_cents: value,
      received_cents: received,
      missing_cents: missing,
      state,
    };
  });
}

/** Money Joana marked as received in Duet, on the day it was received. */
export interface DuetReceipt {
  date: string;
  amount_cents: number;
  title: string;
  project: string | null;
}

/**
 * What was received between `from` and `to`, by payment date: the payments
 * dated in the range, plus — for old events without payments — the whole
 * value of events flagged paid whose paid_at (or, without it, event date)
 * falls in the range. `events` must include every event referenced by
 * `payments` and the paid-flag candidates; `withPayments` lists the ids of
 * events that have any payment (those never count by the flag).
 */
export function toDuetReceipts(
  events: DuetEventRow[],
  payments: DuetPaymentRow[],
  withPayments: Set<string>,
  projects: DuetProjectRow[],
  from: string,
  to: string,
): DuetReceipt[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const project = new Map(projects.map((p) => [p.id, p.name]));
  const label = (e: DuetEventRow | undefined) => ({
    title: (e?.title ?? "").trim() || "Evento",
    project: e?.project_id ? project.get(e.project_id) ?? null : null,
  });
  const out: DuetReceipt[] = [];
  for (const p of payments) {
    const d = (p.paid_at ?? "").slice(0, 10);
    if (!d || d < from || d > to) continue;
    out.push({ date: d, amount_cents: cents(p.amount), ...label(byId.get(p.event_id)) });
  }
  for (const e of events) {
    if (!e.paid || withPayments.has(e.id)) continue;
    const d = (e.paid_at ?? e.event_date ?? "").slice(0, 10);
    if (d < from || d > to) continue;
    const v = cents(e.value);
    if (v > 0) out.push({ date: d, amount_cents: v, ...label(e) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** A from/to date range the function accepts (ISO dates, at most ~13 months). */
export function validRange(from: unknown, to: unknown): { from: string; to: string } | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== "string" || typeof to !== "string" || !iso.test(from) || !iso.test(to)) return null;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!(days >= 0 && days <= 400)) return null;
  return { from, to };
}
