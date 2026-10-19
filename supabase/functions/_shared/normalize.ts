// Pure helpers shared conceptually by the eb-sync Edge Function and tested here.
// No Deno or Supabase APIs — safe to import from vitest.
//
// Dedup key (spec 4.1): external_id = transaction_id OR entry_reference OR a
// hash of booking_date + amount + remittance. entry_reference is preferred
// when present because it stays stable as a movement goes pending → booked,
// which avoids creating a duplicate on the next sync.

export interface EBAmount {
  amount: string; // e.g. "12.34"
  currency?: string;
}

export interface EBTransaction {
  transaction_amount: EBAmount;
  credit_debit_indicator: "CRDT" | "DBIT" | string;
  booking_date?: string | null;
  value_date?: string | null;
  remittance_information?: string[] | string | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  entry_reference?: string | null;
  transaction_id?: string | null;
  status?: string | null; // BOOK | PDNG
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
  if (tx.transaction_id && tx.transaction_id.trim())
    return `tid:${tx.transaction_id.trim()}`;
  const cents = signedCents(tx);
  const rem = normalizeRemittance(remittanceText(tx.remittance_information));
  return `h:${bookingDate}:${cents}:${fnv1a(rem)}`;
}

export function signedCents(tx: EBTransaction): number {
  const cents = Math.abs(toCents(tx.transaction_amount?.amount ?? "0"));
  return tx.credit_debit_indicator === "DBIT" ? -cents : cents;
}

export function normalizeTransaction(
  tx: EBTransaction,
  todayISO: string,
): NormalizedTx {
  const bookingDate = (tx.booking_date || tx.value_date || todayISO).slice(0, 10);
  const amount = signedCents(tx);
  const counterparty =
    amount >= 0 ? (tx.debtor?.name ?? null) : (tx.creditor?.name ?? null);
  const booked = (tx.status ?? "BOOK").toUpperCase() !== "PDNG";
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
