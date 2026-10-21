// monthly-close — on day 1 (cron 08:00 UTC) closes the month before (Lisbon
// date) with the month engine: its totals and the plan's go to
// monthly_snapshots.metrics (no AI text), and a push says what was left.
// Cron-driven (every household) or for the caller's own household; an
// optional { month: "YYYY-MM" } closes another month.
// Never logs amounts or movements: only counts.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { pushToHousehold } from "../_shared/push.ts";
import { householdIds, loadEngineData } from "../_shared/engineData.ts";
import { closeMessage, closeMetrics, previousMonth } from "../_shared/alertRules.ts";
import { monthBreakdown, monthEndBalances, todayLisbon } from "../_shared/engine/month.ts";
import { planTotals } from "../_shared/engine/plan.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

async function closeHousehold(svc: SupabaseClient, householdId: string, month: string, now: Date) {
  const data = await loadEngineData(svc, householdId, now);
  const b = monthBreakdown(data.txs, data.ctx, month);
  const totals = data.rawPlan
    ? planTotals(data.ctx.incomes, data.ctx.categories, data.plan, data.members.map((m) => m.id))
    : null;
  const saldoFim = data.balanceCents == null ? null : (monthEndBalances(data.txs, data.balanceCents, [month]).get(month) ?? null);
  const metrics = closeMetrics(b, totals, saldoFim);

  const { error } = await svc
    .from("monthly_snapshots")
    .upsert({ household_id: householdId, month, metrics, summary_text: null }, { onConflict: "household_id,month" });
  if (error) throw error;

  // A month without movements (no bank yet) has nothing to tell. "Sem
  // categoria" counts like the app's screens: no category, Apple Pay notes aside.
  const semCount = data.txs.filter((t) => t.booking_date.slice(0, 7) === month && !t.category_id && t.source !== "applepay").length;
  if (b.txCount > 0) await pushToHousehold(svc, householdId, closeMessage({ ...b, semCount }), "fecho_mes");
  return metrics;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    if (body.month != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.month))) {
      return json({ error: "mês inválido (AAAA-MM)" }, 400);
    }
    const month: string = body.month ?? previousMonth(todayLisbon(now));

    if (isCronRequest(req)) {
      const ids = await householdIds(svc);
      let closed = 0;
      for (const id of ids) {
        try {
          await closeHousehold(svc, id, month, now);
          closed++;
        } catch (_e) {
          /* one household's failure must not abort the whole batch */
        }
      }
      console.log(JSON.stringify({ fn: "monthly-close", month, households: ids.length, closed }));
      return json({ month, closed });
    }

    // Non-cron: only the caller's own household (never a client-supplied id).
    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    const metrics = await closeHousehold(svc, ctx.householdId, month, now);
    return json({ month, metrics });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
