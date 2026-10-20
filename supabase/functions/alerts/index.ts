// alerts — daily checks that push notifications (spec 10): bank consent
// expiring. Cron-driven (service role) or per-household.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { pushToHousehold } from "../_shared/push.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

async function checkHousehold(svc: SupabaseClient, householdId: string): Promise<number> {
  let sent = 0;
  const now = Date.now();

  // 1) Bank consent expiring (14 / 3 days).
  const { data: conn } = await svc
    .from("bank_connections")
    .select("valid_until, status")
    .eq("household_id", householdId)
    .eq("status", "active")
    .maybeSingle();
  if (conn?.valid_until) {
    const days = Math.floor((Date.parse(conn.valid_until) - now) / 86400000);
    // Only on the milestone days (spec: 14 and 3), plus the expiry day itself.
    if (days === 14 || days === 3 || days === 0) {
      sent += await pushToHousehold(
        svc,
        householdId,
        { title: "Ligação ao banco", body: `A ligação ao Santander expira em ${days} dias.`, url: "/ligar-banco" },
        "ligacao_banco",
      );
    }
  }

  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();

    if (isCronRequest(req)) {
      const { data: households } = await svc.from("households").select("id");
      let total = 0;
      for (const h of households ?? []) {
        try {
          total += await checkHousehold(svc, h.id as string);
        } catch (_e) {
          /* isolate per-household failures */
        }
      }
      return json({ sent: total });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    return json({ sent: await checkHousehold(svc, ctx.householdId) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
