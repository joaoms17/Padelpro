// notify — sends Web Push notifications.
//   • { test: true } from a signed-in user → a test notification to their household
//   • { type: "weekly" } (service role, cron on Sunday) → each household's week
//     on the dia a dia and what is still within the month's limit
//   • { household_id, title, body, prefKey? } (service role) → a custom push
// Never logs amounts or movements: only counts.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { pushToHousehold } from "../_shared/push.ts";
import { householdIds, loadEngineData } from "../_shared/engineData.ts";
import { weeklySummary } from "../_shared/alertRules.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();
    const body = await req.json().catch(() => ({}));

    const isService = isCronRequest(req);

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
      const ids = await householdIds(svc);
      const now = new Date();
      let total = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const data = await loadEngineData(svc, id, now);
          const week = weeklySummary(data.txs, data.ctx, data.plan);
          total += await pushToHousehold(svc, id, { title: "Resumo da semana", body: week.body, url: "/" }, "resumo_semana");
        } catch (_e) {
          failed++; // isolate per-household failures
        }
      }
      console.log(JSON.stringify({ fn: "notify", type: "weekly", households: ids.length, sent: total, failed }));
      return json({ sent: total, failed });
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
