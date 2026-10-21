// alerts — the daily pushes (cron 08:30 UTC; spec §3.9): the bank consent
// about to expire and, once the plan is in force, what deserves attention in
// the current month (Lisbon date) — limits, pace, fixed costs, incomes,
// mesadas, Joana — each once per item, level and month (settings.alerts_sent).
// Cron-driven (service role) or for the caller's own household.
// Never logs amounts or movements: only counts.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { pushToHousehold } from "../_shared/push.ts";
import { householdIds, loadEngineData, loadSettings } from "../_shared/engineData.ts";
import { consentMessage, monthAlerts, pendingAlerts, planInForce, recordSent } from "../_shared/alertRules.ts";
import { todayLisbon } from "../_shared/engine/month.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

/** At most this many plan alerts a day per household; the rest follow on the next days. */
const MAX_PER_DAY = 4;

async function consentAlert(svc: SupabaseClient, householdId: string, now: Date): Promise<number> {
  const { data: conn } = await svc
    .from("bank_connections")
    .select("valid_until, status")
    .eq("household_id", householdId)
    .eq("status", "active")
    .maybeSingle();
  const msg = consentMessage(conn?.valid_until as string | null | undefined, now.getTime());
  return msg ? await pushToHousehold(svc, householdId, msg, "ligacao_banco") : 0;
}

async function planAlerts(svc: SupabaseClient, householdId: string, now: Date): Promise<number> {
  const settings = await loadSettings(svc, householdId);
  const month = todayLisbon(now).slice(0, 7);
  // Before migration 0015 nothing can be recorded, so nothing is sent.
  if (!settings.alertsSent || !planInForce(settings.plan, month)) return 0;

  const data = await loadEngineData(svc, householdId, now, settings);
  const due = pendingAlerts(monthAlerts(data), settings.alertsSent, month, MAX_PER_DAY);
  if (due.length === 0) return 0;

  // Recorded first: an alert that could not be recorded would repeat every day.
  const { error } = await svc
    .from("settings")
    .update({ alerts_sent: recordSent(settings.alertsSent, month, due) })
    .eq("household_id", householdId);
  if (error) return 0;

  let sent = 0;
  for (const a of due) sent += await pushToHousehold(svc, householdId, { title: a.title, body: a.body, url: a.url }, a.pref);
  return sent;
}

async function checkHousehold(svc: SupabaseClient, householdId: string, now: Date): Promise<number> {
  return (await consentAlert(svc, householdId, now)) + (await planAlerts(svc, householdId, now));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();
    const now = new Date();

    if (isCronRequest(req)) {
      const ids = await householdIds(svc);
      let total = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          total += await checkHousehold(svc, id, now);
        } catch (_e) {
          failed++; // isolate per-household failures
        }
      }
      console.log(JSON.stringify({ fn: "alerts", households: ids.length, sent: total, failed }));
      return json({ sent: total, failed });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    return json({ sent: await checkHousehold(svc, ctx.householdId, now) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
