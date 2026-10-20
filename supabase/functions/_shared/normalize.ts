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
 * Normalises one fetch of an account's movements into upsert-safe rows.
 * - Cancelled/rejected movements are dropped (their ids reported apart).
 * - Identical hashed movements (two equal coffees the same day) get distinct
 *   ids via an occurrence counter that is independent of the bank's order and
 *   of cancelled entries: booked ones take #0..#n first, then provisional
 *   ones only beyond that — so a pending twin of a booked movement collapses
 *   into it instead of becoming a second row.
 * - One row per external_id (booked wins), as an upsert batch must never
 *   touch the same row twice.
 */
export function prepareBatch(txs: EBTransaction[], todayISO: string): PreparedBatch {
  const live: { n: NormalizedTx; base: string }[] = [];
  const cancelled: string[] = [];
  for (const tx of txs) {
    const n = normalizeTransaction(tx, todayISO);
    if (isCancelled(tx)) cancelled.push(n.external_id);
    else live.push({ n, base: n.external_id });
  }

  // Hashed ids: index per base key, booked before provisional.
  const groups = new Map<string, NormalizedTx[]>();
  for (const { n, base } of live) {
    if (!base.startsWith("h:")) continue;
    groups.set(base, [...(groups.get(base) ?? []), n]);
  }
  const keep = new Set<NormalizedTx>(live.filter((x) => !x.base.startsWith("h:")).map((x) => x.n));
  for (const [base, list] of groups) {
    const booked = list.filter((n) => n.status === "confirmado");
    const prov = list.filter((n) => n.status === "provisorio");
    // Provisional twins of booked movements are the same movements.
    const ordered = [...booked, ...prov.slice(booked.length)];
    ordered.forEach((n, k) => {
      n.external_id = k === 0 ? base : `${base}#${k}`;
      keep.add(n);
    });
  }

  const byId = new Map<string, NormalizedTx>();
  for (const { n } of live) {
    if (!keep.has(n)) continue;
    const prev = byId.get(n.external_id);
    if (prev && prev.status === "confirmado" && n.status === "provisorio") continue;
    byId.set(n.external_id, n);
  }
  // A cancelled entry only removes a stored row that is not also live now.
  const cancelledIds = [...new Set(cancelled)].filter((id) => !byId.has(id));
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
