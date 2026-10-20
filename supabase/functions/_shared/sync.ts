// Core bank-sync routine, shared by eb-sync (cron / manual) and eb-callback
// (initial pull). Fetches transactions + balance per account, upserts with
// dedup, and never overwrites user-set fields (category, note).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { EBError, ebFetch } from "./eb.ts";
import { pickBalance, prepareBatch, toCents, type EBBalance, type EBTransaction } from "./normalize.ts";
import { candidateIds, findStale, planPending, type StoredPending } from "./pending.ts";
import { reconcileHousehold, proposeEventMatches, proposeCashSettlements } from "./reconcile.ts";

interface Account {
  id: string;
  household_id: string;
  name: string;
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

type Strategy = "default" | "longest";

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
    .select("id, household_id, name, eb_account_uid")
    .eq("household_id", householdId)
    .not("eb_account_uid", "is", null);

  const list = (accounts ?? []) as Account[];
  const today = new Date();
  const todayISO = isoDate(today);

  // First import: full history is only offered for ~1h after the consent, and
  // only with strategy=longest (date_from is then a lower bound). Afterwards:
  // from (last successful sync − 5 days), so an outage never drops movements
  // and pending → booked is caught (spec 4.1).
  const first = !conn?.last_sync_at;
  const from = first ? new Date(today) : new Date(conn.last_sync_at);
  from.setDate(from.getDate() - (first ? 365 : 5));
  const fromISO = isoDate(from);

  let processed = 0;
  const errors: string[] = [];

  for (const acc of list) {
    if (!acc.eb_account_uid) continue;
    try {
      processed += await syncAccount(svc, householdId, acc, fromISO, todayISO, first ? "longest" : "default");
      await updateBalance(svc, acc);
    } catch (e) {
      // One account failing must not stop the others.
      errors.push(`${acc.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Reconcile Apple Pay provisionals + propose event payment matches.
  try {
    await reconcileHousehold(svc, householdId);
    await proposeEventMatches(svc, householdId);
    await proposeCashSettlements(svc, householdId);
  } catch {
    /* reconciliation is best-effort; bank data already synced */
  }

  const error = errors.length ? errors.join(" · ") : undefined;
  if (conn) {
    // last_sync_at only moves on full success: it is the start of the next
    // window, so a failing sync must not skip over the days it missed.
    await svc
      .from("bank_connections")
      .update(error ? { last_error: error } : { last_sync_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);
  }
  return { accounts: list.length, processed, error };
}

async function syncAccount(
  svc: SupabaseClient,
  householdId: string,
  acc: Account,
  fromISO: string,
  todayISO: string,
  strategy: Strategy,
): Promise<number> {
  let txs: EBTransaction[];
  try {
    txs = await fetchAllTransactions(acc.eb_account_uid!, fromISO, todayISO, strategy);
  } catch (e) {
    // The bank can refuse a period with the default strategy; "longest"
    // returns whatever it has instead of an error.
    if (strategy === "default" && e instanceof EBError && e.code === "WRONG_TRANSACTIONS_PERIOD") {
      txs = await fetchAllTransactions(acc.eb_account_uid!, fromISO, todayISO, "longest");
    } else {
      throw e;
    }
  }

  const { rows, cancelledIds } = prepareBatch(txs, todayISO);

  // Cancelled/rejected: drop the provisional row if we had stored it.
  if (cancelledIds.length) {
    const { data: gone } = await svc
      .from("transactions")
      .select("id")
      .eq("account_id", acc.id)
      .eq("source", "banco")
      .eq("status", "provisorio")
      .in("external_id", cancelledIds);
    await removeRows(svc, householdId, (gone ?? []).map((g) => g.id as string));
  }

  await reconcilePending(svc, householdId, acc, rows, fromISO, todayISO);

  // Merge on conflict — provided columns update (pending → booked),
  // category_id and note are not provided so they are preserved.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((n) => ({
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
    }));
    const { error } = await svc.from("transactions").upsert(chunk, { onConflict: "account_id,external_id" });
    if (error) throw error;
  }
  return rows.length;
}

/**
 * Provisional rows the bank no longer returns are re-pointed to their booked
 * version (kept in place with the user's category/links) or, if the bank
 * dropped them over 10 days ago, removed. See pending.ts.
 */
async function reconcilePending(
  svc: SupabaseClient,
  householdId: string,
  acc: Account,
  rows: { external_id: string; amount_cents: number; booking_date: string; status: "confirmado" | "provisorio" }[],
  fromISO: string,
  todayISO: string,
): Promise<void> {
  const { data: pend } = await svc
    .from("transactions")
    .select("id, external_id, amount_cents, booking_date")
    .eq("account_id", acc.id)
    .eq("source", "banco")
    .eq("status", "provisorio");
  const stale = findStale((pend ?? []) as StoredPending[], new Set(rows.map((r) => r.external_id)), fromISO);
  if (stale.length === 0) return;

  const cands = candidateIds(stale, rows);
  let existing: string[] = [];
  if (cands.length) {
    const { data } = await svc
      .from("transactions")
      .select("external_id")
      .eq("account_id", acc.id)
      .in("external_id", cands);
    existing = (data ?? []).map((d) => d.external_id as string);
  }

  const plan = planPending(stale, rows, new Set(existing), todayISO);
  for (const r of plan.relink) {
    const { error } = await svc.from("transactions").update({ external_id: r.external_id }).eq("id", r.id);
    if (error) throw error;
  }
  await removeRows(svc, householdId, plan.remove);
}

/** Deletes bank rows and closes any open review item that points at them. */
async function removeRows(svc: SupabaseClient, householdId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await svc
    .from("review_items")
    .update({ status: "resolvido", resolved_at: new Date().toISOString() })
    .eq("household_id", householdId)
    .eq("status", "aberto")
    .in("ref->>transaction_id", ids);
  const { error } = await svc.from("transactions").delete().in("id", ids);
  if (error) throw error;
}

async function fetchAllTransactions(
  uid: string,
  dateFrom: string,
  dateTo: string,
  strategy: Strategy,
): Promise<EBTransaction[]> {
  const out: EBTransaction[] = [];
  let continuation: string | null = null;
  const seen = new Set<string>();
  // Hard cap + repeated-key guard so a misbehaving API never loops forever.
  // A page can be empty and still carry a continuation_key: keep going.
  for (let page = 0; page < 200; page++) {
    // Follow-up pages must repeat the first request's parameters.
    const qs = new URLSearchParams({ date_from: dateFrom, strategy });
    if (strategy === "default") qs.set("date_to", dateTo);
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
    const bal = await ebFetch<{ balances: EBBalance[] }>(`/accounts/${acc.eb_account_uid}/balances`);
    const preferred = pickBalance(bal.balances);
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
