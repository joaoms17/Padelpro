// Apple Pay ↔ bank reconciliation — pure, testable (no Deno/Supabase).
// An Apple Pay provisional matches a bank movement when (spec 4.2):
//   • same absolute amount,
//   • the bank date is between −1 and +3 days of the purchase,
//   • the merchant text is similar.
// On a match the bank movement is the source of truth and the provisional
// stops counting (never double-count).

export interface ApplePayTx {
  id: string;
  amount_cents: number; // expense, typically negative
  merchant: string;
  occurred_at: string; // ISO date/datetime of the purchase
}

export interface BankTx {
  id: string;
  amount_cents: number;
  description_raw: string | null;
  merchant_clean: string | null;
  booking_date: string; // ISO
}

const DATE_MIN = -1; // bank can post 1 day before (rare) …
const DATE_MAX = 3; // … up to 3 days after the purchase
const SIMILARITY_THRESHOLD = 0.4;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeForMatch(s: string | null): string {
  if (!s) return "";
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalizeForMatch(s).split(" ").filter((t) => t.length >= 3));
}

/** Dice coefficient over word tokens, 0..1. */
export function merchantSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const dice = (2 * inter) / (ta.size + tb.size);
  if (dice > 0) return dice;
  // fall back to substring containment for single-token merchants
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na && nb && (na.includes(nb) || nb.includes(na))) return 0.5;
  return 0;
}

function dayDiff(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(toISO.slice(0, 10) + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

export function isMatch(ap: ApplePayTx, bank: BankTx): boolean {
  if (Math.abs(ap.amount_cents) !== Math.abs(bank.amount_cents)) return false;
  const diff = dayDiff(ap.occurred_at, bank.booking_date);
  if (diff < DATE_MIN || diff > DATE_MAX) return false;
  const bankName = bank.merchant_clean || bank.description_raw || "";
  return merchantSimilarity(ap.merchant, bankName) >= SIMILARITY_THRESHOLD;
}

export interface MatchPair {
  applePayId: string;
  bankId: string;
  score: number;
}

/**
 * Greedily pair each provisional with its best unused bank movement.
 * Returns the pairs; unpaired provisionals are simply absent.
 */
export function reconcile(
  provisionals: ApplePayTx[],
  bankTxs: BankTx[],
): MatchPair[] {
  const usedBank = new Set<string>();
  const pairs: MatchPair[] = [];

  for (const ap of provisionals) {
    let best: { bank: BankTx; score: number } | null = null;
    for (const bank of bankTxs) {
      if (usedBank.has(bank.id)) continue;
      if (!isMatch(ap, bank)) continue;
      const score = merchantSimilarity(
        ap.merchant,
        bank.merchant_clean || bank.description_raw || "",
      );
      if (!best || score > best.score) best = { bank, score };
    }
    if (best) {
      usedBank.add(best.bank.id);
      pairs.push({ applePayId: ap.id, bankId: best.bank.id, score: best.score });
    }
  }

  return pairs;
}

/** Days a provisional has waited unmatched (for the 7-day "Por rever" rule). */
export function daysWaiting(occurredAt: string, todayISO: string): number {
  return dayDiff(occurredAt, todayISO);
}

export const UNMATCHED_REVIEW_DAYS = 7;
export const AMOUNT_TEXT_RE = /-?\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,2})?/;

/** Parse the Apple Pay amount text (e.g. "12,34 €") into positive cents. */
export function parseAppleAmount(text: string): number | null {
  const m = String(text).match(AMOUNT_TEXT_RE);
  if (!m) return null;
  const cleaned = m[0]
    .replace(/[ .](?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(Math.abs(n) * 100);
}
