import { supabase } from "@/lib/supabase";
import { categoriesWithRole } from "@/lib/categories";
import type { Category } from "@/lib/types";
import { addPayment } from "./events";

/** The household's "Eventos Joana" category (role "eventos"), if any. */
async function eventosCategory(householdId: string): Promise<Category | null> {
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("household_id", householdId)
    .eq("grp", "entrada")
    .eq("archived", false);
  return categoriesWithRole((data as Category[]) ?? [], "eventos")[0] ?? null;
}

export interface EventMatchRef {
  transaction_id: string;
  event_id: string;
  client_name: string | null;
  kind: "sinal" | "restante";
  amount_cents: number;
  method: "mbway" | "transferencia";
}

export interface EventProposal {
  id: string;
  ref: EventMatchRef;
}

export async function listEventProposals(householdId: string): Promise<EventProposal[]> {
  const { data } = await supabase
    .from("review_items")
    .select("id, ref")
    .eq("household_id", householdId)
    .eq("type", "event_match")
    .eq("status", "aberto")
    .order("created_at", { ascending: false });
  return (data as EventProposal[]) ?? [];
}

async function resolveItem(id: string): Promise<void> {
  await supabase
    .from("review_items")
    .update({ status: "resolvido", resolved_at: new Date().toISOString() })
    .eq("id", id);
}

/** Confirm a proposal: record the payment on the event, category the credit. */
export async function confirmEventProposal(
  householdId: string,
  item: EventProposal,
): Promise<void> {
  const r = item.ref;

  // Use the credit's own date.
  const { data: tx } = await supabase
    .from("transactions")
    .select("booking_date")
    .eq("id", r.transaction_id)
    .maybeSingle();
  const receivedAt = (tx?.booking_date as string) ?? new Date().toISOString().slice(0, 10);

  await addPayment({
    eventId: r.event_id,
    kind: r.kind,
    amountCents: r.amount_cents,
    receivedAt,
    method: r.method,
    location: "conta_casa",
    transactionId: r.transaction_id,
  });

  // Category the bank credit as "Eventos Joana" if that category exists.
  const cat = await eventosCategory(householdId);
  if (cat) {
    await supabase
      .from("transactions")
      .update({ category_id: cat.id, category_source: "manual" })
      .eq("id", r.transaction_id);
  }

  await resolveItem(item.id);
}

export async function dismissEventProposal(item: EventProposal): Promise<void> {
  await resolveItem(item.id);
}

// ── Cash/Revolut settlement proposals (spec 5.2) ────────────────────────────

export interface SettlementRef {
  transaction_id: string;
  payment_ids: string[];
  amount_cents: number;
}
export interface SettlementProposal {
  id: string;
  ref: SettlementRef;
}

export async function listSettlementProposals(householdId: string): Promise<SettlementProposal[]> {
  const { data } = await supabase
    .from("review_items")
    .select("id, ref")
    .eq("household_id", householdId)
    .eq("type", "settlement")
    .eq("status", "aberto")
    .order("created_at", { ascending: false });
  return (data as SettlementProposal[]) ?? [];
}

/** Confirm: mark the por_transferir payments as arrived + category the credit. */
export async function confirmSettlement(
  householdId: string,
  item: SettlementProposal,
): Promise<void> {
  const r = item.ref;
  await supabase
    .from("event_payments")
    .update({ location: "conta_casa", transaction_id: r.transaction_id })
    .in("id", r.payment_ids);

  const cat = await eventosCategory(householdId);
  if (cat) {
    await supabase
      .from("transactions")
      .update({ category_id: cat.id, category_source: "manual" })
      .eq("id", r.transaction_id);
  }
  await resolveItem(item.id);
}

export async function dismissSettlement(item: SettlementProposal): Promise<void> {
  await resolveItem(item.id);
}
