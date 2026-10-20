// Pending → booked reconciliation for bank movements. Pure (no Deno or
// Supabase APIs) so it is unit-tested with vitest.
//
// Banks usually give a pending movement no entry_reference, so its hashed id
// changes when it is booked (new date, sometimes new text). Instead of
// deleting the provisional row — which would lose the user's category, splits,
// event payment and review links — the row is re-pointed to the booked
// movement's external_id before the upsert, which then updates it in place.

export interface StoredPending {
  id: string;
  external_id: string;
  amount_cents: number;
  booking_date: string; // YYYY-MM-DD
}

export interface ReturnedRow {
  external_id: string;
  amount_cents: number;
  booking_date: string;
  status: "confirmado" | "provisorio";
}

export interface PendingPlan {
  /** Re-point these provisional rows to a booked/newer movement. */
  relink: { id: string; external_id: string }[];
  /** Provisional rows the bank dropped long ago (cancelled holds). */
  remove: string[];
}

const DAY = 86400000;
const toMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

/** Provisional rows inside the fetched window that the bank no longer returns. */
export function findStale(
  pending: StoredPending[],
  returnedIds: Set<string>,
  windowFrom: string,
): StoredPending[] {
  return pending.filter((p) => !returnedIds.has(p.external_id) && p.booking_date >= windowFrom);
}

/** A booked movement may be dated a few days before/after its pending version. */
function inWindow(stale: StoredPending, row: ReturnedRow): boolean {
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
 * @param existingIds external_ids already stored for this account — only a
 *   movement that is NEW can absorb a stale row (otherwise the upsert would
 *   hit the unique (account_id, external_id) constraint).
 */
export function planPending(
  stale: StoredPending[],
  returned: ReturnedRow[],
  existingIds: Set<string>,
  todayISO: string,
  graceDays = 10,
): PendingPlan {
  const plan: PendingPlan = { relink: [], remove: [] };
  const claimed = new Set<string>();
  const fresh = returned.filter((r) => !existingIds.has(r.external_id));

  for (const s of [...stale].sort((a, b) => a.booking_date.localeCompare(b.booking_date))) {
    const match = fresh
      .filter((r) => !claimed.has(r.external_id) && r.amount_cents === s.amount_cents && inWindow(s, r))
      .sort((a, b) => {
        // Booked first, then the closest date.
        if (a.status !== b.status) return a.status === "confirmado" ? -1 : 1;
        return Math.abs(toMs(a.booking_date) - toMs(s.booking_date)) -
          Math.abs(toMs(b.booking_date) - toMs(s.booking_date));
      })[0];

    if (match) {
      claimed.add(match.external_id);
      plan.relink.push({ id: s.id, external_id: match.external_id });
    } else if ((toMs(todayISO) - toMs(s.booking_date)) / DAY > graceDays) {
      plan.remove.push(s.id);
    }
  }
  return plan;
}
