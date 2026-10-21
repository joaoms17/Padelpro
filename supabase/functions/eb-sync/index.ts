// eb-sync — pulls transactions + balances, then files the new movements
// (rules, history, known shops, incomes; no AI here — see categorize).
// Two ways in:
//   • cron (pg_cron/pg_net, x-cron-secret) → syncs every household
//     ({ check: true } instead only verifies the Enable Banking credentials)
//   • a signed-in user ("Sincronizar agora") → syncs just their household
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { syncHousehold } from "../_shared/sync.ts";
import { categorizeHousehold } from "../_shared/categorizeRun.ts";
import { EBError, findSantanderPT, getApplication, type EBApplication } from "../_shared/eb.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();

    if (isCronRequest(req)) {
      const body = await req.json().catch(() => ({}));
      if (body.check) {
        // Deploy smoke test: signs a JWT, reads the app, lists the PT banks.
        // An app not yet activated is reported as such (not as an error).
        const notActive = (e: unknown) => e instanceof EBError && e.code === "APPLICATION_NOT_ACTIVE";
        let app: EBApplication = {};
        try {
          app = await getApplication();
        } catch (e) {
          if (!notActive(e)) throw e;
          app = { active: false };
        }
        const base = {
          mode: "check",
          environment: app.environment ?? null,
          redirect_urls: app.redirect_urls ?? [],
        };
        if (app.active === false) return json({ ...base, active: false, aspsp: null });
        try {
          const aspsp = await findSantanderPT();
          return json({ ...base, active: app.active ?? true, aspsp: aspsp.name });
        } catch (e) {
          if (notActive(e)) return json({ ...base, active: false, aspsp: null });
          throw e;
        }
      }
      // cron path: sync all households with an active connection
      const { data: conns } = await svc
        .from("bank_connections")
        .select("household_id")
        .eq("status", "active");
      const results = [];
      for (const c of conns ?? []) {
        const householdId = c.household_id as string;
        const synced = await syncHousehold(svc, householdId);
        results.push({ household_id: householdId, ...synced, categorized: await categorizeQuietly(svc, householdId) });
      }
      return json({ mode: "all", results });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    const result = await syncHousehold(svc, ctx.householdId);
    return json({ mode: "one", ...result, categorized: await categorizeQuietly(svc, ctx.householdId) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** File what came in; a failure here never fails the sync itself. */
async function categorizeQuietly(svc: ReturnType<typeof serviceClient>, householdId: string): Promise<number | null> {
  try {
    const r = await categorizeHousehold(svc, householdId, { ai: false, aiDeadline: 0 });
    return r.assigned;
  } catch (_e) {
    return null;
  }
}
