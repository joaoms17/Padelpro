// Core bank-sync routine, shared by eb-sync (cron / manual) and eb-callback
// (initial pull). Fetches transactions + balance per account, upserts with
// dedup, and never overwrites user-set fields (category, note).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { EBError, ebFetch } from "./eb.ts";
import { pickBalance, prepareBatch, toCents, type EBBalance, type EBTransaction } from "./normalize.ts";
import { candidateIds, fetchStart, findStale, planPending, type StoredPending } from "./pending.ts";
import { reconcileHousehold } from "./reconcile.ts";

interface Account {
  id: string;
  household_id: string;
  name: string;
  eb_account_uid: string | null;
  eb_last_sync_at: string | null;
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
    .select("id, household_id, name, eb_account_uid, eb_last_sync_at")
    .eq("household_id", householdId)
    .not("eb_account_uid", "is", null);

  const list = (accounts ?? []) as Account[];
  const today = new Date();
  const todayISO = isoDate(today);

  let processed = 0;
  const errors: string[] = [];

  for (const acc of list) {
    if (!acc.eb_account_uid) continue;
    try {
      processed += await syncAccount(svc, householdId, acc, today, todayISO);
      await updateBalance(svc, acc);
      await svc.from("accounts").update({ eb_last_sync_at: new Date().toISOString() }).eq("id", acc.id);
    } catch (e) {
      // One account failing must not stop the others.
      errors.push(`${acc.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Reconcile Apple Pay provisionals.
  try {
    await reconcileHousehold(svc, householdId);
  } catch {
    /* reconciliation is best-effort; bank data already synced */
  }

  const error = errors.length ? errors.join(" · ") : undefined;
  if (conn) {
    // Shown in the app as "Última sincronização": only on full success.
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
  today: Date,
  todayISO: string,
): Promise<number> {
  // The window is per account. Never synced (new, or first link): full
  // history, which banks only offer for ~1h after the consent and only with
  // strategy=longest (date_from is then a lower bound). Otherwise from the
  // account's last successful sync − 5 days (an outage never drops movements;
  // pending → booked is caught), pulled back to cover still-open pending
  // rows; after a long gap (> ~85 days) the bank may refuse "default".
  const { data: pend } = await svc
    .from("transactions")
    .select("id, external_id, amount_cents, booking_date, description_raw, created_at")
    .eq("account_id", acc.id)
    .eq("source", "banco")
    .eq("status", "provisorio");
  const pending = (pend ?? []) as StoredPending[];

  let strategy: Strategy;
  let fromISO: string;
  if (!acc.eb_last_sync_at) {
    strategy = "longest";
    fromISO = isoDate(new Date(today.getTime() - 365 * 86400000));
  } else {
    const last = new Date(acc.eb_last_sync_at);
    fromISO = fetchStart(isoDate(new Date(last.getTime() - 5 * 86400000)), pending, todayISO);
    strategy = today.getTime() - Date.parse(`${fromISO}T00:00:00Z`) > 85 * 86400000 ? "longest" : "default";
  }

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

  // Cancelled/rejected stored pending rows go through reconciliation too: a
  // voided twin of a booked movement is relinked/merged, otherwise removed.
  await reconcilePending(svc, householdId, acc, pending, rows, new Set(cancelledIds), fromISO, todayISO);

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
 * version (kept in place with the user's category/links), merged into it if
 * it is already stored, or — if the bank dropped them — removed after a grace
 * period. See pending.ts.
 */
async function reconcilePending(
  svc: SupabaseClient,
  householdId: string,
  acc: Account,
  pending: StoredPending[],
  rows: { external_id: string; amount_cents: number; booking_date: string; status: "confirmado" | "provisorio"; description_raw: string }[],
  cancelledIds: Set<string>,
  fromISO: string,
  todayISO: string,
): Promise<void> {
  const { stale, expired } = findStale(pending, new Set(rows.map((r) => r.external_id)), fromISO, todayISO);
  await removeRows(svc, householdId, expired);
  if (stale.length === 0) return;

  const cands = candidateIds(stale, rows);
  let stored: { id: string; external_id: string; created_at: string | null }[] = [];
  if (cands.length) {
    const { data, error } = await svc
      .from("transactions")
      .select("id, external_id, created_at")
      .eq("account_id", acc.id)
      .in("external_id", cands);
    if (error) throw error;
    stored = (data ?? []) as typeof stored;
  }

  const plan = planPending(stale, rows, stored, todayISO, 10, cancelledIds);
  for (const r of plan.relink) {
    const { error } = await svc.from("transactions").update({ external_id: r.external_id }).eq("id", r.id);
    if (error) throw error;
  }
  for (const m of plan.merge) await mergeInto(svc, householdId, m.id, m.into_id);
  await removeRows(svc, householdId, plan.remove);
}

/**
 * Folds a provisional row into the stored booked row of the same movement:
 * the user's category/note (when the booked row has none), splits, event
 * payment, Apple Pay match and open review items move over; then it goes.
 */
async function mergeInto(svc: SupabaseClient, householdId: string, fromId: string, intoId: string): Promise<void> {
  const [{ data: from }, { data: into }] = await Promise.all([
    svc.from("transactions").select("category_id, category_source, confidence, note").eq("id", fromId).maybeSingle(),
    svc.from("transactions").select("category_id, category_source, note").eq("id", intoId).maybeSingle(),
  ]);
  if (!from || !into) return;

  // The pending row's category wins when someone chose it and the booked one
  // only has an automatic guess (filed by the sync in between).
  const chosen = (s: string | null) => s === "manual" || s === "rule" || s === "mesada" || s === "applepay";
  const patch: Record<string, unknown> = {};
  if (from.category_id && (!into.category_id || (chosen(from.category_source) && !chosen(into.category_source)))) {
    Object.assign(patch, {
      category_id: from.category_id,
      category_source: from.category_source,
      confidence: from.confidence,
    });
  }
  if (from.note && !into.note) patch.note = from.note;
  if (Object.keys(patch).length) {
    const { error } = await svc.from("transactions").update(patch).eq("id", intoId);
    if (error) throw error;
  }

  const { count: splitsOnInto } = await svc
    .from("transaction_splits")
    .select("id", { count: "exact", head: true })
    .eq("transaction_id", intoId);
  if (!splitsOnInto) {
    await svc.from("transaction_splits").update({ transaction_id: intoId }).eq("transaction_id", fromId);
  }
  await svc.from("event_payments").update({ transaction_id: intoId }).eq("transaction_id", fromId);
  await svc.from("transactions").update({ matched_transaction_id: intoId }).eq("matched_transaction_id", fromId);

  // Open review items move over — unless the booked row already has the same
  // proposal (same type and event / payments), which would double-record it.
  const { data: items } = await svc
    .from("review_items")
    .select("id, type, ref")
    .eq("household_id", householdId)
    .eq("status", "aberto")
    .in("ref->>transaction_id", [fromId, intoId]);
  const key = (it: { type: string; ref: unknown }) => {
    const r = it.ref as { event_id?: string; payment_ids?: string[] };
    return `${it.type}:${r.event_id ?? ""}:${(r.payment_ids ?? []).join(",")}`;
  };
  const onInto = new Set(
    (items ?? []).filter((it) => (it.ref as { transaction_id?: string }).transaction_id === intoId).map(key),
  );
  for (const it of (items ?? []).filter((x) => (x.ref as { transaction_id?: string }).transaction_id === fromId)) {
    if (onInto.has(key(it))) {
      await svc.from("review_items")
        .update({ status: "resolvido", resolved_at: new Date().toISOString() })
        .eq("id", it.id);
    } else {
      await svc.from("review_items")
        .update({ ref: { ...(it.ref as Record<string, unknown>), transaction_id: intoId } })
        .eq("id", it.id);
    }
  }

  const { error } = await svc.from("transactions").delete().eq("id", fromId);
  if (error) throw error;
}

/** Deletes bank rows and closes any open review item that points at them. */
export async function removeRows(svc: SupabaseClient, householdId: string, ids: string[]): Promise<void> {
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
