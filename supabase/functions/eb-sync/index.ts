// eb-sync — pulls transactions + balances.
// Two ways in:
//   • cron (pg_cron/pg_net) with the service-role key → syncs every household
//   • a signed-in user ("Sincronizar agora") → syncs just their household
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { syncHousehold } from "../_shared/sync.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isService = serviceKey && authHeader === `Bearer ${serviceKey}`;
    const svc = serviceClient();

    if (isService) {
      // cron path: sync all households with an active connection
      const { data: conns } = await svc
        .from("bank_connections")
        .select("household_id")
        .eq("status", "active");
      const results = [];
      for (const c of conns ?? []) {
        results.push({
          household_id: c.household_id,
          ...(await syncHousehold(svc, c.household_id as string)),
        });
      }
      return json({ mode: "all", results });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    const result = await syncHousehold(svc, ctx.householdId);
    return json({ mode: "one", ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
