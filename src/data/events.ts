import { supabase } from "@/lib/supabase";
import type { EventRow, Payment, EventStatus } from "@/lib/events";

export async function listEvents(householdId: string): Promise<EventRow[]> {
  const { data } = await supabase
    .from("events")
    .select("id, date, type, client_name, service_cents, expense_allowance_cents, expected_costs_cents, status")
    .eq("household_id", householdId)
    .order("date", { ascending: false });
  return (data as EventRow[]) ?? [];
}

export async function listPayments(eventIds: string[]): Promise<Payment[]> {
  if (eventIds.length === 0) return [];
  const { data } = await supabase
    .from("event_payments")
    .select("id, event_id, kind, amount_cents, received_at, method, location")
    .in("event_id", eventIds);
  return (data as Payment[]) ?? [];
}

export interface NewEvent {
  householdId: string;
  date: string;
  type: string;
  clientName: string | null;
  location?: string | null;
  serviceCents: number;
  expenseAllowanceCents?: number;
  km?: number;
  expectedCostsCents?: number;
  notes?: string | null;
}

export async function createEvent(e: NewEvent): Promise<string> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      household_id: e.householdId,
      date: e.date,
      type: e.type,
      client_name: e.clientName,
      location: e.location ?? null,
      service_cents: e.serviceCents,
      expense_allowance_cents: e.expenseAllowanceCents ?? 0,
      km: e.km ?? 0,
      expected_costs_cents: e.expectedCostsCents ?? 0,
      notes: e.notes ?? null,
      status: "pedido",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateEventStatus(id: string, status: EventStatus): Promise<void> {
  const { error } = await supabase.from("events").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

export interface NewPayment {
  eventId: string;
  kind: Payment["kind"];
  amountCents: number;
  receivedAt: string;
  method: Payment["method"];
  location: Payment["location"];
  transactionId?: string | null;
}

export async function addPayment(p: NewPayment): Promise<void> {
  const { error } = await supabase.from("event_payments").insert({
    event_id: p.eventId,
    kind: p.kind,
    amount_cents: p.amountCents,
    received_at: p.receivedAt,
    method: p.method,
    location: p.location,
    transaction_id: p.transactionId ?? null,
  });
  if (error) throw error;
}

/** Mark a por_transferir payment as arrived in the Conta Casa. */
export async function settlePayment(id: string): Promise<void> {
  const { error } = await supabase
    .from("event_payments")
    .update({ location: "conta_casa" })
    .eq("id", id);
  if (error) throw error;
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.from("event_payments").delete().eq("id", id);
  if (error) throw error;
}
