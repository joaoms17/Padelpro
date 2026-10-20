// Pending → booked reconciliation for bank movements. Pure (no Deno or
// Supabase APIs) so it is unit-tested with vitest.
//
// Banks usually give a pending movement no entry_reference, so its hashed id
// changes when it is booked (new date, sometimes new text). Instead of
// deleting the provisional row — which would lose the user's category, splits,
// event payment and review links — the row is either re-pointed to the booked
// movement's external_id before the upsert (which then updates it in place),
// or, when the booked version is already stored, merged into it.
import { merchantSimilarity, SIMILARITY_THRESHOLD } from "./match.ts";

export interface StoredPending {
  id: string;
  external_id: string;
  amount_cents: number;
  booking_date: string; // YYYY-MM-DD
  description_raw?: string | null;
  created_at?: string | null;
}

export interface ReturnedRow {
  external_id: string;
  amount_cents: number;
  booking_date: string;
  status: "confirmado" | "provisorio";
  description_raw?: string | null;
}

/** A booked bank row that is already stored (candidate for a merge). */
export interface StoredBooked {
  id: string;
  external_id: string;
  created_at?: string | null;
}

export interface PendingPlan {
  /** Re-point these provisional rows to a new movement's external_id. */
  relink: { id: string; external_id: string }[];
  /** Fold these provisional rows into an already-stored booked row. */
  merge: { id: string; into_id: string }[];
  /** Provisional rows the bank dropped (cancelled holds) — delete. */
  remove: string[];
}

const DAY = 86400000;
const toMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

/**
 * Splits the stored provisional rows the bank did not return this time:
 * `stale` lie inside the fetched window [from, to] (the bank would have
 * returned them if still pending) and can be relinked/merged/expired;
 * `expired` are older than the window (only past the fetch cap) and go.
 * Rows dated after `to` (scheduled, future) are left alone.
 */
export function findStale(
  pending: StoredPending[],
  returnedIds: Set<string>,
  from: string,
  to: string,
): { stale: StoredPending[]; expired: string[] } {
  const gone = pending.filter((p) => !returnedIds.has(p.external_id));
  return {
    stale: gone.filter((p) => p.booking_date >= from && p.booking_date <= to),
    expired: gone.filter((p) => p.booking_date < from).map((p) => p.id),
  };
}

/** A booked movement may be dated a few days before/after its pending version. */
function inWindow(stale: StoredPending, row: { booking_date: string }): boolean {
  const delta = (toMs(row.booking_date) - toMs(stale.booking_date)) / DAY;
  return delta >= -3 && delta <= 10;
}

/** Returned rows that could be the booked version of a stale row. */
export function candidateIds(stale: StoredPending[], returned: ReturnedRow[]): string[] {
  return returned
    .filter((r) => stale.some((s) => s.amount_cents === r.amount_cents && inWindow(s, r)))
    .map((r) => r.external_id);
}

/** Hashed ids of identical movements share a base: "h:…" and "h:…#1". */
const baseOf = (id: string) => (id.startsWith("h:") ? id.split("#")[0] : id);

/**
 * @param stored candidates (from candidateIds) that are already stored for
 *   this account. A NEW movement absorbs a stale row by relink; a stored,
 *   booked one (inserted while the bank still listed the pending too) by merge.
 * @param cancelledIds ids the bank reported as cancelled this time: such a
 *   row is still matched first (a voided twin of a booked movement), else it
 *   is removed at once instead of waiting for the grace period.
 *
 * A candidate needs evidence that it is the same movement — same amount and
 * date window, plus a similar description when both have one (or the same
 * hashed base) — never the amount alone, or a released fuel hold would end up
 * on an unrelated withdrawal of the same value.
 */
export function planPending(
  stale: StoredPending[],
  returned: ReturnedRow[],
  stored: StoredBooked[],
  todayISO: string,
  graceDays = 10,
  cancelledIds: Set<string> = new Set(),
): PendingPlan {
  const plan: PendingPlan = { relink: [], merge: [], remove: [] };
  const storedById = new Map(stored.map((s) => [s.external_id, s]));
  const claimed = new Set<string>();

  for (const s of [...stale].sort((a, b) => a.booking_date.localeCompare(b.booking_date))) {
    const sim = (r: ReturnedRow) => merchantSimilarity(s.description_raw ?? "", r.description_raw ?? "");
    const sameBase = (r: ReturnedRow) => s.external_id.startsWith("h:") && baseOf(r.external_id) === baseOf(s.external_id);
    const similar = (r: ReturnedRow) =>
      sameBase(r) || !s.description_raw || !r.description_raw || sim(r) >= SIMILARITY_THRESHOLD;

    const candidates = returned.filter((r) => {
      if (claimed.has(r.external_id) || r.amount_cents !== s.amount_cents || !inWindow(s, r)) return false;
      if (!similar(r)) return false;
      const row = storedById.get(r.external_id);
      if (!row) return true; // fresh: relink
      // Stored: only a booked row, and only one stored after the pending one
      // (or the same hashed movement), never an older unrelated movement.
      return r.status === "confirmado" &&
        (sameBase(r) || !s.created_at || !row.created_at || row.created_at >= s.created_at);
    });

    const best = candidates.sort((a, b) => {
      // Booked first, then the most similar text, then fresh over stored,
      // then the closest date.
      if (a.status !== b.status) return a.status === "confirmado" ? -1 : 1;
      const ds = sim(b) - sim(a);
      if (ds !== 0) return ds;
      const fa = storedById.has(a.external_id) ? 1 : 0;
      const fb = storedById.has(b.external_id) ? 1 : 0;
      if (fa !== fb) return fa - fb;
      return Math.abs(toMs(a.booking_date) - toMs(s.booking_date)) -
        Math.abs(toMs(b.booking_date) - toMs(s.booking_date));
    })[0];

    if (best) {
      claimed.add(best.external_id);
      const row = storedById.get(best.external_id);
      if (row) plan.merge.push({ id: s.id, into_id: row.id });
      else plan.relink.push({ id: s.id, external_id: best.external_id });
    } else if (cancelledIds.has(s.external_id) || (toMs(todayISO) - toMs(s.booking_date)) / DAY > graceDays) {
      plan.remove.push(s.id);
    }
  }
  return plan;
}

/**
 * Start of the fetch window: the usual incremental start, pulled back to
 * cover still-open provisional rows (so they can resolve), capped at maxDays.
 */
export function fetchStart(incrementalFrom: string, pending: StoredPending[], todayISO: string, maxDays = 30): string {
  const cap = new Date(toMs(todayISO) - maxDays * DAY).toISOString().slice(0, 10);
  let from = incrementalFrom;
  for (const p of pending) {
    if (p.booking_date > todayISO) continue;
    const want = new Date(toMs(p.booking_date) - 3 * DAY).toISOString().slice(0, 10);
    if (want < from) from = want;
  }
  return from < cap ? (incrementalFrom < cap ? incrementalFrom : cap) : from;
}
