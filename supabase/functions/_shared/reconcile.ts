// Reconcile Apple Pay provisionals against real bank movements. Runs at the
// end of each eb-sync (spec 4.2). On a match the bank movement is the source
// of truth; the provisional is linked and stops counting.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { reconcile, type ApplePayTx, type BankTx } from "./match.ts";

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
