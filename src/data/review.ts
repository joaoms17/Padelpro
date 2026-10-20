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
