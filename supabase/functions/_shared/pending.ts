// Pending → booked reconciliation for bank movements. Pure (no Deno or
// Supabase APIs) so it is unit-tested with vitest.
//
// Banks usually give a pending movement no entry_reference, so its hashed id
// changes when it is booked (new date, sometimes new text). Instead of
// deleting the provisional row — which would lose the user's category, splits,
// event payment and review links — the row is either re-pointed to the booked
// movement's external_id before the upsert (which then updates it in place),
// or, when the booked version is already stored, merged into it.
import { merchantSimilarity } from "./match.ts";

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

/**
 * @param stored candidates (from candidateIds) that are already stored for
 *   this account. A NEW movement absorbs a stale row by relink; a stored,
 *   booked one (inserted while the bank still listed the pending too) by merge.
 */
export function planPending(
  stale: StoredPending[],
  returned: ReturnedRow[],
  stored: StoredBooked[],
  todayISO: string,
  graceDays = 10,
): PendingPlan {
  const plan: PendingPlan = { relink: [], merge: [], remove: [] };
  const storedById = new Map(stored.map((s) => [s.external_id, s]));
  const claimed = new Set<string>();

  const rank = (s: StoredPending) => (a: ReturnedRow, b: ReturnedRow) => {
    // Booked first, then the most similar text, then the closest date.
    if (a.status !== b.status) return a.status === "confirmado" ? -1 : 1;
    const sim = (r: ReturnedRow) => merchantSimilarity(s.description_raw ?? "", r.description_raw ?? "");
    const ds = sim(b) - sim(a);
    if (ds !== 0) return ds;
    return Math.abs(toMs(a.booking_date) - toMs(s.booking_date)) -
      Math.abs(toMs(b.booking_date) - toMs(s.booking_date));
  };

  for (const s of [...stale].sort((a, b) => a.booking_date.localeCompare(b.booking_date))) {
    const same = returned.filter((r) =>
      !claimed.has(r.external_id) && r.amount_cents === s.amount_cents && inWindow(s, r)
    );

    const fresh = same.filter((r) => !storedById.has(r.external_id)).sort(rank(s))[0];
    if (fresh) {
      claimed.add(fresh.external_id);
      plan.relink.push({ id: s.id, external_id: fresh.external_id });
      continue;
    }

    // Booked version already stored (it was inserted while the bank still
    // listed the pending one): merge — but only into a row stored after the
    // pending one, never into an older, unrelated movement.
    const booked = same
      .filter((r) => r.status === "confirmado" && storedById.has(r.external_id))
      .filter((r) => {
        const row = storedById.get(r.external_id)!;
        return !s.created_at || !row.created_at || row.created_at >= s.created_at;
      })
      .sort(rank(s))[0];
    if (booked) {
      claimed.add(booked.external_id);
      plan.merge.push({ id: s.id, into_id: storedById.get(booked.external_id)!.id });
      continue;
    }

    if ((toMs(todayISO) - toMs(s.booking_date)) / DAY > graceDays) plan.remove.push(s.id);
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
