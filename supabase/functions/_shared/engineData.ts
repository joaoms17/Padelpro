// Loads what the month engine needs for one household, with the service
// client (Edge Functions only): every movement of the house account (paged,
// no row cap), categories (archived too), members, expected incomes, the
// monthly mesadas and the plan. Mirrors src/data/engine.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { todayLisbon, type EngineCtx, type EngineIncome, type EngineTx } from "./engine/month.ts";
import { normalizePlan, type PlanSettings } from "./engine/plan.ts";
import type { MesadaMonth } from "./engine/mesadas.ts";
import type { Category, Member } from "./engine/types.ts";
import type { AlertsSent } from "./alertRules.ts";

export interface HouseholdSettings {
  /** settings.plan as stored (null: none yet, or before migration 0015). */
  rawPlan: Record<string, unknown> | null;
  plan: PlanSettings;
  /** settings.alerts_sent; null when it cannot be read (before migration 0015). */
  alertsSent: AlertsSent | null;
}

export interface EngineData extends HouseholdSettings {
  txs: EngineTx[];
  /** `today` is the Lisbon date. */
  ctx: EngineCtx;
  members: Member[];
  mesadaMonths: MesadaMonth[];
  /** Today's balance of the house account (null until the bank told us). */
  balanceCents: number | null;
}

export async function loadSettings(svc: SupabaseClient, householdId: string): Promise<HouseholdSettings> {
  const { data, error } = await svc
    .from("settings")
    .select("plan, alerts_sent")
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) return { rawPlan: null, plan: normalizePlan(null), alertsSent: null };
  const row = (data ?? {}) as { plan?: Record<string, unknown> | null; alerts_sent?: AlertsSent | null };
  const rawPlan = row.plan && Object.keys(row.plan).length > 0 ? row.plan : null;
  return {
    rawPlan,
    plan: normalizePlan(rawPlan as Partial<PlanSettings> | null),
    alertsSent: row.alerts_sent && typeof row.alerts_sent === "object" ? row.alerts_sent : {},
  };
}

const TX_COLUMNS = "id, booking_date, amount_cents, category_id, category_source, description_raw, source";

/** Movements of the given accounts (all of the household's when null), oldest first. */
async function loadTxs(svc: SupabaseClient, householdId: string, accountIds: string[] | null): Promise<EngineTx[]> {
  const out: EngineTx[] = [];
  let columns = `${TX_COLUMNS}, pontual`;
  for (let from = 0; ; from += 1000) {
    let q = svc
      .from("transactions")
      .select(columns)
      .eq("household_id", householdId)
      // Apple Pay notes already matched to a bank movement never count twice.
      .is("matched_transaction_id", null);
    if (accountIds) q = q.in("account_id", accountIds);
    const { data, error } = await q.order("booking_date").order("id").range(from, from + 999);
    if (error) {
      // Before migration 0015 there is no `pontual` column: load without it.
      if (columns.includes("pontual") && from === 0) {
        columns = TX_COLUMNS;
        from = -1000;
        continue;
      }
      throw error;
    }
    const rows = (data ?? []) as unknown as EngineTx[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function loadEngineData(
  svc: SupabaseClient,
  householdId: string,
  now: Date = new Date(),
  settings?: HouseholdSettings,
): Promise<EngineData> {
  const [accRes, catRes, memRes, incRes, mesRes, set] = await Promise.all([
    svc.from("accounts").select("id, role, balance_cents, balance_at").eq("household_id", householdId),
    svc.from("categories").select("*").eq("household_id", householdId).order("sort"),
    svc.from("members").select("id, display_name, mesada_cents").eq("household_id", householdId).order("created_at"),
    svc.from("expected_incomes").select("*").eq("household_id", householdId).order("created_at"),
    svc.from("mesada_months").select("member_id, month, amount_cents").eq("household_id", householdId),
    settings ? Promise.resolve(settings) : loadSettings(svc, householdId),
  ]);
  if (accRes.error) throw accRes.error;
  if (catRes.error) throw catRes.error;
  if (memRes.error) throw memRes.error;

  const accounts = (accRes.data ?? []) as { id: string; role: string; balance_cents: number; balance_at: string | null }[];
  const casa = accounts.filter((a) => a.role === "casa");
  // Only the house account counts (all of them, if none is marked as such).
  const txs = await loadTxs(svc, householdId, casa.length ? casa.map((a) => a.id) : null);

  const bankDates = txs.filter((t) => t.source === "banco" || t.source === "extrato").map((t) => t.booking_date);
  const firstDataDate = bankDates.length ? bankDates.reduce((a, d) => (d < a ? d : a)) : null;
  const known = casa.filter((a) => a.balance_at);
  const categories = (catRes.data ?? []) as Category[];
  const members = (memRes.data ?? []) as Member[];
  // Before migrations 0011 / 0014 these tables do not exist: nothing set up.
  const incomes = (incRes.error ? [] : incRes.data ?? []) as EngineIncome[];
  const mesadaMonths = (mesRes.error ? [] : mesRes.data ?? []) as MesadaMonth[];

  return {
    ...set,
    txs,
    ctx: { categories, members, incomes, today: todayLisbon(now), firstDataDate },
    members,
    mesadaMonths,
    balanceCents: known.length ? known.reduce((a, x) => a + Number(x.balance_cents), 0) : null,
  };
}

/** Every household id (the crons run for each). */
export async function householdIds(svc: SupabaseClient): Promise<string[]> {
  const { data, error } = await svc.from("households").select("id");
  if (error) throw error;
  return (data ?? []).map((h) => h.id as string);
}
