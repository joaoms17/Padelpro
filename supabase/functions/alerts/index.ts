// alerts — daily checks that push notifications (spec 10): bank consent
// expiring, event money sitting outside the Conta Casa for 7+ days, and the
// cushion dropping below target. Cron-driven (service role) or per-household.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { pushToHousehold } from "../_shared/push.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

function eur(cents: number): string {
  return (cents / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

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
    if (days >= 0 && days <= 14) {
      sent += await pushToHousehold(
        svc,
        householdId,
        { title: "Ligação ao banco", body: `A ligação ao Santander expira em ${days} dias.`, url: "/ligar-banco" },
        "ligacao_banco",
      );
    }
  }

  // 2) Event money outside the Conta Casa for 7+ days.
  const { data: events } = await svc.from("events").select("id").eq("household_id", householdId);
  const eventIds = (events ?? []).map((e) => e.id as string);
  if (eventIds.length) {
    const cutoff = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    const { data: pays } = await svc
      .from("event_payments")
      .select("amount_cents, received_at")
      .in("event_id", eventIds)
      .eq("location", "por_transferir");
    const overdue = (pays ?? []).filter((p) => (p.received_at ?? "9999") <= cutoff);
    const total = overdue.reduce((a, p) => a + (p.amount_cents as number), 0);
    if (total > 0) {
      sent += await pushToHousehold(
        svc,
        householdId,
        { title: "Eventos por transferir", body: `Há ${eur(total)} de eventos por transferir há mais de 7 dias.`, url: "/eventos" },
        "eventos_fora",
      );
    }
  }

  // 3) Cushion below target (proxy: balance / avg monthly despesas from snapshots).
  const [{ data: acc }, { data: snaps }, { data: settings }] = await Promise.all([
    svc.from("accounts").select("balance_cents").eq("household_id", householdId).eq("role", "casa").maybeSingle(),
    svc.from("monthly_snapshots").select("metrics").eq("household_id", householdId).order("month", { ascending: false }).limit(3),
    svc.from("settings").select("cushion_target_months").eq("household_id", householdId).maybeSingle(),
  ]);
  const target = settings?.cushion_target_months ?? 3;
  const balance = acc?.balance_cents ?? 0;
  const despesas = (snaps ?? [])
    .map((s) => (s.metrics as { despesas_casa_cents?: number; mesadas_cents?: number }))
    .map((m) => (m.despesas_casa_cents ?? 0) + (m.mesadas_cents ?? 0));
  const avg = despesas.length ? despesas.reduce((a, b) => a + b, 0) / despesas.length : 0;
  if (avg > 0) {
    const months = balance / avg;
    if (months < target) {
      sent += await pushToHousehold(
        svc,
        householdId,
        { title: "Almofada", body: `A almofada está em ${months.toFixed(1)} meses (alvo: ${target}).`, url: "/metricas" },
        "almofada",
      );
    }
  }

  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
      const { data: households } = await svc.from("households").select("id");
      let total = 0;
      for (const h of households ?? []) total += await checkHousehold(svc, h.id as string);
      return json({ sent: total });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    return json({ sent: await checkHousehold(svc, ctx.householdId) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
