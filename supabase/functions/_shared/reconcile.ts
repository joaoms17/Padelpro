// Reconcile Apple Pay provisionals against real bank movements, and propose
// event-payment matches for bank credits. Runs at the end of each eb-sync (spec 4.2). On a match the bank movement is
// the source of truth; the provisional is linked and stops counting.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { reconcile, type ApplePayTx, type BankTx } from "./match.ts";
import { matchEntradaToEvents, type OpenEvent } from "./eventmatch.ts";

export interface ReconcileResult {
  matched: number;
  provisionals: number;
}

export async function reconcileHousehold(
  svc: SupabaseClient,
  householdId: string,
): Promise<ReconcileResult> {
  // Unmatched Apple Pay provisionals.
  const { data: provData } = await svc
    .from("transactions")
    .select("id, amount_cents, description_raw, merchant_clean, booking_date, category_id, category_source, note")
    .eq("household_id", householdId)
    .eq("source", "applepay")
    .eq("status", "provisorio")
    .is("matched_transaction_id", null);

  const provisionals = (provData ?? []) as Array<{
    id: string;
    amount_cents: number;
    description_raw: string | null;
    merchant_clean: string | null;
    booking_date: string;
    category_id: string | null;
    category_source: string | null;
    note: string | null;
  }>;
  if (provisionals.length === 0) return { matched: 0, provisionals: 0 };

  // Candidate bank-side movements in a generous window around the provisionals.
  const minDate = provisionals
    .map((p) => p.booking_date)
    .reduce((a, b) => (a < b ? a : b));
  const from = new Date(Date.parse(minDate.slice(0, 10) + "T00:00:00Z") - 2 * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data: bankData } = await svc
    .from("transactions")
    .select("id, amount_cents, description_raw, merchant_clean, booking_date, category_id, note")
    .eq("household_id", householdId)
    .in("source", ["banco", "extrato", "manual"])
    .is("matched_transaction_id", null)
    .gte("booking_date", from);

  const banks = (bankData ?? []) as Array<{
    id: string;
    amount_cents: number;
    description_raw: string | null;
    merchant_clean: string | null;
    booking_date: string;
    category_id: string | null;
    note: string | null;
  }>;

  const apInput: ApplePayTx[] = provisionals.map((p) => ({
    id: p.id,
    amount_cents: p.amount_cents,
    merchant: p.merchant_clean || p.description_raw || "",
    occurred_at: p.booking_date,
  }));
  const bankInput: BankTx[] = banks.map((b) => ({
    id: b.id,
    amount_cents: b.amount_cents,
    description_raw: b.description_raw,
    merchant_clean: b.merchant_clean,
    booking_date: b.booking_date,
  }));

  const pairs = reconcile(apInput, bankInput);
  const provById = new Map(provisionals.map((p) => [p.id, p]));
  const bankById = new Map(banks.map((b) => [b.id, b]));

  for (const pair of pairs) {
    const prov = provById.get(pair.applePayId)!;
    const bk = bankById.get(pair.bankId)!;

    // Bank movement inherits the provisional's category/note if the user set
    // them and the bank row has none yet.
    const patch: Record<string, unknown> = {};
    if (prov.category_id && !bk.category_id) {
      patch.category_id = prov.category_id;
      // A guess (suggestion/AI) stays a guess to confirm; a choice is kept as Apple Pay's.
      const guessed = prov.category_source === "sugestao" || prov.category_source === "ai";
      patch.category_source = guessed ? prov.category_source : "applepay";
    }
    if (prov.note && !bk.note) patch.note = prov.note;
    if (Object.keys(patch).length) {
      await svc.from("transactions").update(patch).eq("id", bk.id);
    }

    // Link the provisional so it stops counting.
    await svc
      .from("transactions")
      .update({ matched_transaction_id: bk.id, updated_at: new Date().toISOString() })
      .eq("id", prov.id);
  }

  return { matched: pairs.length, provisionals: provisionals.length };
}

/**
 * Propose matches between incoming bank credits and open event payments
 * (spec 5.2). Writes "event_match" review_items the user confirms with one tap.
 */
export async function proposeEventMatches(
  svc: SupabaseClient,
  householdId: string,
): Promise<number> {
  // Open events (still owed, not cancelled/paid).
  const { data: events } = await svc
    .from("events")
    .select("id, client_name, service_cents, expense_allowance_cents, status")
    .eq("household_id", householdId)
    .in("status", ["pedido", "confirmado", "realizado"]);
  if (!events || events.length === 0) return 0;

  const eventIds = events.map((e) => e.id as string);
  const { data: pays } = await svc
    .from("event_payments")
    .select("event_id, amount_cents, transaction_id")
    .in("event_id", eventIds);

  const paidByEvent = new Map<string, number>();
  const linkedTxIds = new Set<string>();
  for (const p of pays ?? []) {
    paidByEvent.set(p.event_id as string, (paidByEvent.get(p.event_id as string) ?? 0) + (p.amount_cents as number));
    if (p.transaction_id) linkedTxIds.add(p.transaction_id as string);
  }

  const openEvents: OpenEvent[] = events.map((e) => ({
    id: e.id as string,
    client_name: e.client_name as string | null,
    outstanding_cents: Math.max(
      0,
      (e.service_cents as number) + (e.expense_allowance_cents as number) - (paidByEvent.get(e.id as string) ?? 0),
    ),
  }));
  if (openEvents.every((e) => e.outstanding_cents <= 0)) return 0;

  // Recent bank credits not yet linked to an event payment.
  const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const { data: credits } = await svc
    .from("transactions")
    .select("id, amount_cents, counterparty, description_raw, merchant_clean")
    .eq("household_id", householdId)
    .in("source", ["banco", "extrato"])
    .gt("amount_cents", 0)
    .gte("booking_date", from);

  // Skip credits already proposed before — including dismissed ones, so a
  // "Não" is not re-proposed on every sync.
  const { data: existing } = await svc
    .from("review_items")
    .select("ref")
    .eq("household_id", householdId)
    .eq("type", "event_match");
  const proposedTxIds = new Set(
    (existing ?? []).map((r) => (r.ref as { transaction_id?: string })?.transaction_id).filter(Boolean),
  );

  let created = 0;
  for (const c of credits ?? []) {
    if (linkedTxIds.has(c.id as string) || proposedTxIds.has(c.id as string)) continue;
    const desc = (c.description_raw as string) || (c.merchant_clean as string) || "";
    const proposal = matchEntradaToEvents(
      { amount_cents: c.amount_cents as number, counterparty: c.counterparty as string | null, description: desc },
      openEvents,
    );
    if (!proposal) continue;
    const ev = events.find((e) => e.id === proposal.eventId)!;
    await svc.from("review_items").insert({
      household_id: householdId,
      type: "event_match",
      status: "aberto",
      ref: {
        transaction_id: c.id,
        event_id: proposal.eventId,
        client_name: ev.client_name,
        kind: proposal.kind,
        amount_cents: proposal.amount_cents,
        method: /mb\s?way/i.test(desc) ? "mbway" : "transferencia",
      },
    });
    created++;
  }
  return created;
}
