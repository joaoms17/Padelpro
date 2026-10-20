// Pure helpers shared conceptually by the eb-sync Edge Function and tested here.
// No Deno or Supabase APIs — safe to import from vitest.
//
// Dedup key (spec 4.1): external_id = entry_reference OR a hash of
// date + amount + remittance (+ an occurrence counter for identical movements).
// transaction_id is NOT used: Enable Banking documents that it may change and
// cannot identify a movement. entry_reference is immutable per account but
// usually only present once booked, so pending rows are reconciled separately
// (see pending.ts).

export interface EBAmount {
  amount: string; // e.g. "12.34"
  currency?: string;
}

export interface EBTransaction {
  transaction_amount: EBAmount;
  credit_debit_indicator: "CRDT" | "DBIT" | string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | string | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  entry_reference?: string | null;
  transaction_id?: string | null;
  status?: string | null; // BOOK | PDNG | HOLD | SCHD | CNCL | RJCT | OTHR
}

export interface NormalizedTx {
  external_id: string;
  booking_date: string;
  value_date: string | null;
  amount_cents: number; // + entrada, - saída
  description_raw: string;
  counterparty: string | null;
  status: "confirmado" | "provisorio";
}

export function toCents(amount: string): number {
  const n = Number.parseFloat(String(amount).replace(",", "."));
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function remittanceText(
  r: string[] | string | null | undefined,
): string {
  if (!r) return "";
  return (Array.isArray(r) ? r.join(" ") : r).replace(/\s+/g, " ").trim();
}

export function normalizeRemittance(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w ]/g, "")
    .trim();
}

// FNV-1a 32-bit, deterministic and dependency-free.
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function ebExternalId(tx: EBTransaction, bookingDate: string): string {
  if (tx.entry_reference && tx.entry_reference.trim())
    return `ref:${tx.entry_reference.trim()}`;
  const cents = signedCents(tx);
  const rem = normalizeRemittance(remittanceText(tx.remittance_information));
  return `h:${bookingDate}:${cents}:${fnv1a(rem)}`;
}

/** Cancelled / rejected movements never count. */
export function isCancelled(tx: EBTransaction): boolean {
  return ["CNCL", "RJCT"].includes((tx.status ?? "").toUpperCase());
}

/** Pending, card holds and scheduled movements are provisional until booked. */
export function isProvisional(tx: EBTransaction): boolean {
  return ["PDNG", "HOLD", "SCHD"].includes((tx.status ?? "").toUpperCase());
}

export function signedCents(tx: EBTransaction): number {
  const cents = Math.abs(toCents(tx.transaction_amount?.amount ?? "0"));
  return tx.credit_debit_indicator === "DBIT" ? -cents : cents;
}

export function normalizeTransaction(
  tx: EBTransaction,
  todayISO: string,
): NormalizedTx {
  const bookingDate = (tx.booking_date || tx.value_date || tx.transaction_date || todayISO)
    .slice(0, 10);
  const amount = signedCents(tx);
  const counterparty =
    amount >= 0 ? (tx.debtor?.name ?? null) : (tx.creditor?.name ?? null);
  const booked = !isProvisional(tx);
  return {
    external_id: ebExternalId(tx, bookingDate),
    booking_date: bookingDate,
    value_date: tx.value_date ? tx.value_date.slice(0, 10) : null,
    amount_cents: amount,
    description_raw: remittanceText(tx.remittance_information),
    counterparty,
    status: booked ? "confirmado" : "provisorio",
  };
}

export interface PreparedBatch {
  rows: NormalizedTx[];
  /** external_ids the bank reports as cancelled/rejected. */
  cancelledIds: string[];
}

/**
 * Normalises one fetch of an account's movements into upsert-safe rows:
 * drops cancelled ones, gives identical hashed movements (two equal coffees
 * on the same day) distinct ids via an occurrence counter, and keeps a single
 * row per external_id (a booked version wins over a provisional one) — an
 * upsert batch must never touch the same row twice.
 */
export function prepareBatch(txs: EBTransaction[], todayISO: string): PreparedBatch {
  const byId = new Map<string, NormalizedTx>();
  const cancelledIds: string[] = [];
  const occurrences = new Map<string, number>();

  for (const tx of txs) {
    const n = normalizeTransaction(tx, todayISO);
    if (n.external_id.startsWith("h:")) {
      const k = occurrences.get(n.external_id) ?? 0;
      occurrences.set(n.external_id, k + 1);
      if (k > 0) n.external_id = `${n.external_id}#${k}`;
    }
    if (isCancelled(tx)) {
      cancelledIds.push(n.external_id);
      continue;
    }
    const prev = byId.get(n.external_id);
    if (prev && prev.status === "confirmado" && n.status === "provisorio") continue;
    byId.set(n.external_id, n);
  }
  return { rows: [...byId.values()], cancelledIds };
}

export interface EBBalance {
  balance_amount: EBAmount;
  balance_type?: string;
}

// Booked balances first: "available" types can include an overdraft or credit
// line, which would overstate the cushion.
const BALANCE_PREFERENCE = ["ITBD", "CLBD", "XPCD", "ITAV", "CLAV", "OPBD"];

/** Picks the balance to show, by type preference (banks return a subset). */
export function pickBalance(balances: EBBalance[] | null | undefined): EBBalance | null {
  const list = balances ?? [];
  for (const type of BALANCE_PREFERENCE) {
    const b = list.find((x) => (x.balance_type ?? "").toUpperCase() === type);
    if (b) return b;
  }
  return list[0] ?? null;
}
