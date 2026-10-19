// Core bank-sync routine, shared by eb-sync (cron / manual) and eb-callback
// (initial pull). Fetches transactions + balance per account, upserts with
// dedup, and never overwrites user-set fields (category, note).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { ebFetch } from "./eb.ts";
import { normalizeTransaction, toCents, type EBTransaction } from "./normalize.ts";
import { reconcileHousehold, proposeEventMatches, proposeCashSettlements } from "./reconcile.ts";

interface Account {
  id: string;
  household_id: string;
  eb_account_uid: string | null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  accounts: number;
  processed: number;
  error?: string;
}

/** Sync every connected account of a household. */
export async function syncHousehold(
  svc: SupabaseClient,
  householdId: string,
): Promise<SyncResult> {
  const { data: conn } = await svc
    .from("bank_connections")
    .select("*")
    .eq("household_id", householdId)
    .eq("status", "active")
    .maybeSingle();

  const { data: accounts } = await svc
    .from("accounts")
    .select("id, household_id, eb_account_uid")
    .eq("household_id", householdId)
    .not("eb_account_uid", "is", null);

  const list = (accounts ?? []) as Account[];
  const today = new Date();
  let processed = 0;

  try {
    for (const acc of list) {
      if (!acc.eb_account_uid) continue;

      // Window: from (last sync − 5 days) so an outage never drops movements;
      // the −5 days also catches pending → booked (spec 4.1). First ever sync
      // pulls a year of history.
      const from = conn?.last_sync_at ? new Date(conn.last_sync_at) : new Date(today);
      from.setDate(from.getDate() - (conn?.last_sync_at ? 5 : 365));
      const txs = await fetchAllTransactions(acc.eb_account_uid, isoDate(from), isoDate(today));

      if (txs.length > 0) {
        const rows = txs.map((t) => {
          const n = normalizeTransaction(t, isoDate(today));
          return {
            household_id: householdId,
            account_id: acc.id,
            source: "banco",
            external_id: n.external_id,
            booking_date: n.booking_date,
            value_date: n.value_date,
            amount_cents: n.amount_cents,
            description_raw: n.description_raw,
            counterparty: n.counterparty,
            status: n.status,
          };
        });
        // Merge on conflict — provided columns update (pending → booked),
        // category_id and note are not provided so they are preserved.
        const { error } = await svc
          .from("transactions")
          .upsert(rows, { onConflict: "account_id,external_id" });
        if (error) throw error;
        processed += rows.length;
      }

      await updateBalance(svc, acc);
    }

    // Reconcile Apple Pay provisionals + propose event payment matches.
    try {
      await reconcileHousehold(svc, householdId);
      await proposeEventMatches(svc, householdId);
      await proposeCashSettlements(svc, householdId);
    } catch {
      /* reconciliation is best-effort; bank data already synced */
    }

    if (conn) {
      await svc
        .from("bank_connections")
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .eq("id", conn.id);
    }
    return { accounts: list.length, processed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (conn) {
      await svc
        .from("bank_connections")
        .update({ last_error: msg, last_sync_at: new Date().toISOString() })
        .eq("id", conn.id);
    }
    return { accounts: list.length, processed, error: msg };
  }
}

async function fetchAllTransactions(
  uid: string,
  dateFrom: string,
  dateTo: string,
): Promise<EBTransaction[]> {
  const out: EBTransaction[] = [];
  let continuation: string | null = null;
  const seen = new Set<string>();
  // Hard cap + repeated-key guard so a misbehaving API never loops forever.
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (continuation) qs.set("continuation_key", continuation);
    const res = await ebFetch<{
      transactions: EBTransaction[];
      continuation_key?: string | null;
    }>(`/accounts/${uid}/transactions?${qs.toString()}`);
    out.push(...(res.transactions ?? []));
    continuation = res.continuation_key ?? null;
    if (!continuation || seen.has(continuation)) break;
    seen.add(continuation);
  }
  return out;
}

async function updateBalance(svc: SupabaseClient, acc: Account): Promise<void> {
  try {
    const bal = await ebFetch<{
      balances: { balance_amount: { amount: string }; balance_type?: string }[];
    }>(`/accounts/${acc.eb_account_uid}/balances`);
    // Prefer the closing booked balance, else the first available.
    const preferred =
      bal.balances?.find((b) => ["CLBD", "XPCD", "ITBD"].includes(b.balance_type ?? "")) ??
      bal.balances?.[0];
    if (preferred) {
      await svc
        .from("accounts")
        .update({
          balance_cents: toCents(preferred.balance_amount.amount),
          balance_at: new Date().toISOString(),
        })
        .eq("id", acc.id);
    }
  } catch {
    /* balance is best-effort; transactions already synced */
  }
}
