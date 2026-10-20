// monthly-close — on day 1 writes a monthly_snapshot with the closed month's
// core metrics (spec 8). The friendly text summary is added in M10 (ai-ask).
// Core P&L is computed inline to avoid importing the frontend metrics engine.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, householdFromRequest } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { pushToHousehold } from "../_shared/push.ts";
import { summarizeMonth } from "../_shared/ai.ts";

type Grp = "entrada" | "fixa" | "variavel" | "atividade" | "mesada" | "interna";

function prevMonth(todayISO: string): string {
  const [y, m] = todayISO.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function range(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [start, end];
}

async function closeHousehold(svc: ReturnType<typeof serviceClient>, householdId: string, month: string) {
  const [start, end] = range(month);
  const [{ data: cats }, { data: txs }, { data: acc }] = await Promise.all([
    svc.from("categories").select("id, grp").eq("household_id", householdId),
    svc
      .from("transactions")
      .select("category_id, amount_cents")
      .eq("household_id", householdId)
      .is("matched_transaction_id", null)
      .gte("booking_date", start)
      .lt("booking_date", end),
    svc.from("accounts").select("balance_cents").eq("household_id", householdId).eq("role", "casa").maybeSingle(),
  ]);

  const grp = new Map<string, Grp>((cats ?? []).map((c) => [c.id as string, c.grp as Grp]));
  let entradas = 0, despesas = 0, mesadas = 0;
  for (const t of txs ?? []) {
    if (!t.category_id) continue;
    const g = grp.get(t.category_id as string);
    if (!g || g === "interna") continue;
    if (g === "entrada") entradas += Math.max(0, t.amount_cents);
    else if (g === "mesada") mesadas += Math.abs(t.amount_cents);
    else despesas += Math.abs(Math.min(0, t.amount_cents));
  }
  const sobra = entradas - despesas - mesadas;

  const metrics = {
    entradas_cents: entradas,
    despesas_casa_cents: despesas,
    mesadas_cents: mesadas,
    sobra_cents: sobra,
    taxa_poupanca: entradas > 0 ? sobra / entradas : 0,
    saldo_conta_casa_cents: acc?.balance_cents ?? null,
  };

  const summary_text = await summarizeMonth(metrics);
  await svc
    .from("monthly_snapshots")
    .upsert({ household_id: householdId, month, metrics, summary_text }, { onConflict: "household_id,month" });

  const sobraEur = (sobra / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await pushToHousehold(
    svc,
    householdId,
    { title: "Fecho do mês", body: `A sobra do mês foi ${sobraEur} €.`, url: "/metricas" },
    "fecho_mes",
  );
  return metrics;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const svc = serviceClient();
    const body = await req.json().catch(() => ({}));
    const month = body.month ?? prevMonth(new Date().toISOString().slice(0, 10));

    if (isCronRequest(req)) {
      const { data: households } = await svc.from("households").select("id");
      let closed = 0;
      for (const h of households ?? []) {
        try {
          await closeHousehold(svc, h.id as string, month);
          closed++;
        } catch (_e) {
          /* one household's failure must not abort the whole batch */
        }
      }
      return json({ month, closed });
    }

    // Non-cron: only the caller's own household (never a client-supplied id).
    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    const metrics = await closeHousehold(svc, ctx.householdId, month);
    return json({ month, metrics });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
