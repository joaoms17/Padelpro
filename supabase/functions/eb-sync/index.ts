// eb-sync — pulls transactions + balances.
// Two ways in:
//   • cron (pg_cron/pg_net, x-cron-secret) → syncs every household
//     ({ check: true } instead only verifies the Enable Banking credentials)
//   • a signed-in user ("Sincronizar agora") → syncs just their household
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { syncHousehold } from "../_shared/sync.ts";
import { findSantanderPT } from "../_shared/eb.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();

    if (isCronRequest(req)) {
      const body = await req.json().catch(() => ({}));
      if (body.check) {
        // Deploy smoke test: signs a JWT and lists the PT banks.
        const aspsp = await findSantanderPT();
        return json({ mode: "check", aspsp: aspsp.name });
      }
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
