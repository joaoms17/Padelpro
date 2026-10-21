import { supabase } from "@/lib/supabase";
import { matchBankCovered } from "@/lib/import";
import type { Transaction, TransactionSource } from "@/lib/types";
import type { ParsedTx } from "@/lib/import";

export interface TxFilters {
  householdId: string;
  month?: string; // "YYYY-MM"
  categoryId?: string | "none"; // "none" = uncategorized
  source?: TransactionSource;
  search?: string;
  onlyReview?: boolean; // provisório ou sem categoria
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [start, end];
}

export async function listTransactions(f: TxFilters): Promise<Transaction[]> {
  let q = supabase
    .from("transactions")
    .select("*")
    .eq("household_id", f.householdId)
    // Exclude Apple Pay provisionals already matched to a bank movement, so
    // they never count twice.
    .is("matched_transaction_id", null)
    .order("booking_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (f.month) {
    const [start, end] = monthRange(f.month);
    q = q.gte("booking_date", start).lt("booking_date", end);
  }
  if (f.categoryId === "none") q = q.is("category_id", null);
  else if (f.categoryId) q = q.eq("category_id", f.categoryId);
  if (f.source) q = q.eq("source", f.source);
  // "Por rever" = uncategorized (includes low-confidence AI, which is left
  // uncategorized). Once a category is assigned the item leaves the queue.
  if (f.onlyReview) q = q.is("category_id", null);
  if (f.search && f.search.trim()) {
    const s = `%${f.search.trim()}%`;
    q = q.or(
      `description_raw.ilike.${s},counterparty.ilike.${s},merchant_clean.ilike.${s}`,
    );
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data as Transaction[]) ?? [];
}

export interface ManualInput {
  householdId: string;
  accountId: string;
  amountCents: number; // already signed (+ entrada, - saída)
  bookingDate: string; // ISO
  categoryId: string | null;
  note?: string;
  method?: string; // informativo (cartão, mbway, transferência)
  createdBy?: string | null;
}

export async function insertManual(i: ManualInput): Promise<void> {
  const { error } = await supabase.from("transactions").insert({
    household_id: i.householdId,
    account_id: i.accountId,
    source: "manual" as TransactionSource,
    external_id: `man:${crypto.randomUUID()}`,
    booking_date: i.bookingDate,
    amount_cents: i.amountCents,
    description_raw: i.note ?? null,
    category_id: i.categoryId,
    category_source: i.categoryId ? "manual" : null,
    status: "confirmado",
    note: i.method ? `método: ${i.method}` : null,
    created_by: i.createdBy ?? null,
  });
  if (error) throw error;
}

export async function setCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .update({
      category_id: categoryId,
      category_source: categoryId ? "manual" : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", transactionId);
  if (error) throw error;
}

/** File several movements at once (a group in "Por categorizar"). */
export async function setCategoryMany(ids: string[], categoryId: string | null): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase
      .from("transactions")
      .update({
        category_id: categoryId,
        category_source: categoryId ? "manual" : null,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids.slice(i, i + 100));
    if (error) throw error;
  }
}

/** Confirm what a suggestion (or the AI) filed: it becomes the couple's own choice. */
export async function confirmSuggested(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase
      .from("transactions")
      .update({ category_source: "manual", updated_at: new Date().toISOString() })
      .in("id", ids.slice(i, i + 100))
      .in("category_source", ["sugestao", "ai"])
      .not("category_id", "is", null);
    if (error) throw error;
  }
}

/** One-off (kept out of the averages and the plan). */
export async function setPontual(transactionId: string, pontual: boolean): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .update({ pontual, updated_at: new Date().toISOString() })
    .eq("id", transactionId);
  if (error) throw error;
}

export async function setNote(
  transactionId: string,
  note: string,
): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .update({ note, updated_at: new Date().toISOString() })
    .eq("id", transactionId);
  if (error) throw error;
}

export interface SplitInput {
  categoryId: string;
  amountCents: number;
}

/** Replace a transaction's splits (each part assigned to a category). */
export async function setSplits(
  transactionId: string,
  splits: SplitInput[],
): Promise<void> {
  const del = await supabase
    .from("transaction_splits")
    .delete()
    .eq("transaction_id", transactionId);
  if (del.error) throw del.error;

  if (splits.length > 0) {
    const ins = await supabase.from("transaction_splits").insert(
      splits.map((s) => ({
        transaction_id: transactionId,
        category_id: s.categoryId,
        amount_cents: s.amountCents,
      })),
    );
    if (ins.error) throw ins.error;
  }
}

export interface ImportOutcome {
  total: number;
  inserted: number;
  duplicates: number;
  /** Statement rows the bank sync already brought (same amount, ±3 days). */
  coveredByBank: number;
}

const DAY_MS = 86400000;
const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * Statement rows that the bank sync already stored, matched one-to-one by
 * amount and a booking date within ±3 days (card payments are booked a day
 * or two after the purchase; statement and bank ids never coincide).
 */
async function bankCovered(accountId: string, items: ParsedTx[]): Promise<Set<ParsedTx>> {
  const covered = new Set<ParsedTx>();
  if (items.length === 0) return covered;
  const dates = items.map((i) => dayMs(i.booking_date));
  const from = new Date(Math.min(...dates) - 3 * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(Math.max(...dates) + 3 * DAY_MS).toISOString().slice(0, 10);

  const bank: { booking_date: string; amount_cents: number }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("booking_date, amount_cents")
      .eq("account_id", accountId)
      .eq("source", "banco")
      .gte("booking_date", from)
      .lte("booking_date", to)
      .order("id")
      .range(off, off + 999);
    if (error) throw error;
    bank.push(...((data as typeof bank) ?? []));
    if (!data || data.length < 1000) break;
  }
  if (bank.length === 0) return covered;

  return matchBankCovered(items, bank);
}

/**
 * Insert parsed statement rows, skipping any that already exist (dedup) and
 * any the bank sync already brought — so a statement can fill the history
 * before the bank link, a gap, or the time after a link lapsed.
 */
export async function importTransactions(
  householdId: string,
  accountId: string,
  items: ParsedTx[],
): Promise<ImportOutcome> {
  const covered = await bankCovered(accountId, items);
  const before = items.filter((it) => !covered.has(it));
  const coveredByBank = covered.size;
  if (before.length === 0) {
    return { total: items.length, inserted: 0, duplicates: 0, coveredByBank };
  }

  const rows = before.map((it) => ({
    household_id: householdId,
    account_id: accountId,
    source: "extrato" as TransactionSource,
    external_id: it.external_id,
    booking_date: it.booking_date,
    amount_cents: it.amount_cents,
    description_raw: it.description_raw,
    status: "confirmado",
  }));

  const { data, error } = await supabase
    .from("transactions")
    .upsert(rows, {
      onConflict: "account_id,external_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;

  const inserted = data?.length ?? 0;
  return {
    total: items.length,
    inserted,
    duplicates: before.length - inserted,
    coveredByBank,
  };
}
