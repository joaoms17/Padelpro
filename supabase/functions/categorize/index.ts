// categorize — classify uncategorized movements for a household, on demand.
// Order: user rules → mesadas → history → suggestions → AI (spec 6.2); see
// _shared/categorizeRun.ts. eb-sync runs the same after each bank sync.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { categorizeHousehold } from "../_shared/categorizeRun.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  try {
    const svc = serviceClient();
    let householdId: string;
    if (isCronRequest(req)) {
      const body = await req.json().catch(() => ({}));
      householdId = body.household_id;
      if (!householdId) return json({ error: "household_id em falta" }, 400);
    } else {
      const ctx = await householdFromRequest(req);
      if (!ctx) return json({ error: "não autenticado" }, 401);
      householdId = ctx.householdId;
    }
    // The request is cut off after ~150 s and one AI call may take up to
    // ~50 s: stop starting batches after ~75 s; the rest waits for the next run.
    return json(await categorizeHousehold(svc, householdId, { ai: true, aiDeadline: started + 75_000 }));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
