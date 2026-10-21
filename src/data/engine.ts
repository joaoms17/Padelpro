import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { listIncomes } from "@/data/incomes";
import { loadMesadaMonths, type MesadaMonth } from "@/data/mesadas";
import { normalizePlan, type PlanSettings } from "@/lib/plan";
import { todayLisbon, type EngineCtx, type EngineIncome, type EngineTx } from "@/lib/month";
import type { Category, Member } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

/** Everything the month and plan calculations need, loaded once per screen. */
export interface EngineData {
  householdId: string;
  txs: EngineTx[];
  ctx: EngineCtx;
  /** Every category (archived ones too, for movements still pointing at them). */
  allCategories: Category[];
  members: Member[];
  incomes: EngineIncome[];
  mesadaMonths: MesadaMonth[];
  plan: PlanSettings;
  /** Today's balance of the house account (null until the bank told us). */
  balanceCents: number | null;
  balanceAt: string | null;
  lastSyncAt: string | null;
  consentUntil: string | null;
}

const TX_COLUMNS = "id, booking_date, amount_cents, category_id, category_source, description_raw, source, account_id";

/** Every movement of the house account (paged: no row cap). */
async function loadTxs(householdId: string): Promise<(EngineTx & { account_id: string })[]> {
  const out: (EngineTx & { account_id: string })[] = [];
  let columns = `${TX_COLUMNS}, pontual`;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select(columns)
      .eq("household_id", householdId)
      // Apple Pay notes already matched to a bank movement never count twice.
      .is("matched_transaction_id", null)
      .order("booking_date")
      .order("id")
      .range(from, from + 999);
    if (error) {
      // Before migration 0015 there is no `pontual` column: load without it.
      if (columns.includes("pontual") && from === 0) {
        columns = TX_COLUMNS;
        from = -1000;
        continue;
      }
      throw error;
    }
    const rows = (data ?? []) as unknown as (EngineTx & { account_id: string })[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function loadEngineData(householdId: string): Promise<EngineData> {
  const [txs, catRes, memRes, incomes, mesadaMonths, setRes, accRes, connRes] = await Promise.all([
    loadTxs(householdId),
    supabase.from("categories").select("*").eq("household_id", householdId).order("sort"),
    supabase.from("members").select("*").eq("household_id", householdId).order("created_at"),
    listIncomes(householdId),
    loadMesadaMonths(householdId),
    supabase.from("settings").select("plan").eq("household_id", householdId).maybeSingle(),
    supabase.from("accounts").select("id, role, balance_cents, balance_at").eq("household_id", householdId),
    supabase.from("bank_connections").select("last_sync_at, valid_until, status").eq("household_id", householdId),
  ]);
  if (catRes.error) throw catRes.error;
  const accounts = (accRes.data ?? []) as { id: string; role: string; balance_cents: number; balance_at: string | null }[];
  const casa = accounts.filter((a) => a.role === "casa");
  const casaIds = new Set(casa.map((a) => a.id));
  // Only the house account counts (all of them, if none is marked as such).
  const houseTxs = casaIds.size ? txs.filter((t) => casaIds.has(t.account_id)) : txs;
  const bankDates = houseTxs.filter((t) => t.source === "banco" || t.source === "extrato").map((t) => t.booking_date);
  const firstDataDate = bankDates.length ? bankDates.reduce((a, d) => (d < a ? d : a)) : null;
  const known = casa.filter((a) => a.balance_at);
  const conns = (connRes.data ?? []) as { last_sync_at: string | null; valid_until: string | null; status: string }[];
  const active = conns.find((c) => c.status === "active") ?? conns[0];
  const allCategories = (catRes.data as Category[]) ?? [];
  const members = (memRes.data as Member[]) ?? [];
  const engineIncomes = incomes as EngineIncome[];

  return {
    householdId,
    txs: houseTxs,
    ctx: {
      categories: allCategories,
      members,
      incomes: engineIncomes,
      today: todayLisbon(),
      firstDataDate,
    },
    allCategories,
    members,
    incomes: engineIncomes,
    mesadaMonths,
    // Missing column/row (before migration 0015) simply means the defaults.
    plan: normalizePlan(setRes.error ? null : ((setRes.data as { plan?: Partial<PlanSettings> } | null)?.plan ?? null)),
    balanceCents: known.length ? known.reduce((a, x) => a + x.balance_cents, 0) : null,
    balanceAt: known.length ? known.map((a) => a.balance_at as string).sort()[0] : null,
    lastSyncAt: active?.last_sync_at ?? null,
    consentUntil: active?.valid_until ?? null,
  };
}

/** Load the engine data for a screen; reload after a change or when coming back to the app. */
export function useEngineData(householdId: string | null) {
  const [data, setData] = useState<EngineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!householdId) return;
    try {
      setData(await loadEngineData(householdId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Back to the app: the other person (or the bank sync) may have changed things.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  return { data, error, loading, reload };
}
