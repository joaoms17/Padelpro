// notify — sends Web Push notifications.
//   • { test: true } from a signed-in user → a test notification to their household
//   • { type: "weekly" } (service role, cron) → weekly summary to all households
//   • { household_id, title, body, prefKey? } (service role) → a custom push
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { pushToHousehold } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();
    const body = await req.json().catch(() => ({}));

    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isService = serviceKey && authHeader === `Bearer ${serviceKey}`;

    // Test notification for the signed-in user's household.
    if (body.test) {
      const ctx = await householdFromRequest(req);
      if (!ctx) return json({ error: "não autenticado" }, 401);
      const sent = await pushToHousehold(svc, ctx.householdId, {
        title: "Contas a Dois",
        body: "As notificações estão a funcionar 🎉",
        url: "/",
      });
      return json({ sent });
    }

    if (!isService) return json({ error: "não autorizado" }, 401);

    if (body.type === "weekly") {
      const { data: households } = await svc.from("households").select("id");
      let total = 0;
      for (const h of households ?? []) {
        try {
          total += await pushToHousehold(
            svc,
            h.id as string,
            { title: "Resumo da semana", body: "Vê como correu a semana nas Contas a Dois.", url: "/metricas" },
            "resumo_semana",
          );
        } catch (_e) {
          /* isolate per-household failures */
        }
      }
      return json({ sent: total });
    }

    if (body.household_id && body.title) {
      const sent = await pushToHousehold(
        svc,
        body.household_id,
        { title: body.title, body: body.body ?? "", url: body.url ?? "/" },
        body.prefKey,
      );
      return json({ sent });
    }

    return json({ error: "pedido inválido" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
