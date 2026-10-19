// ai-ask — "Pergunta à app" (spec 11). Claude Sonnet with tool use over a
// fixed set of read-only functions (never free SQL). The tools run server-side
// with the service role, scoped to the caller's household.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { redactForAI, displayMerchant } from "../_shared/categorize.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";

type Grp = "entrada" | "fixa" | "variavel" | "atividade" | "mesada" | "interna";

const TOOLS = [
  {
    name: "resumo_mes",
    description: "Totais de um mês: entradas, despesas da casa, mesadas e sobra.",
    input_schema: { type: "object", properties: { mes: { type: "string", description: "YYYY-MM" } }, required: ["mes"] },
  },
  {
    name: "gastos_por_categoria",
    description: "Soma das despesas por categoria num período.",
    input_schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "data ISO YYYY-MM-DD" },
        fim: { type: "string", description: "data ISO YYYY-MM-DD (exclusivo)" },
        categoria: { type: "string", description: "nome parcial da categoria (opcional)" },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    name: "movimentos",
    description: "Lista de movimentos filtrados.",
    input_schema: {
      type: "object",
      properties: {
        inicio: { type: "string" },
        fim: { type: "string" },
        texto: { type: "string", description: "pesquisa no comerciante/descrição" },
        limite: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "eventos",
    description: "Eventos da Joana, opcionalmente por período e estado.",
    input_schema: {
      type: "object",
      properties: {
        inicio: { type: "string" },
        fim: { type: "string" },
        estado: { type: "string", description: "pedido|confirmado|realizado|pago|cancelado" },
      },
      required: [],
    },
  },
  {
    name: "objetivos",
    description: "Objetivos de poupança: alvo, reservado e data limite.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "almofada",
    description: "Saldo atual da Conta Casa e o último fecho mensal registado.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

async function runTool(
  svc: SupabaseClient,
  householdId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "resumo_mes": {
      const mes = String(input.mes ?? "");
      const [y, m] = mes.split("-").map(Number);
      if (!y || !m) return { erro: "mês inválido" };
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const [{ data: cats }, { data: txs }] = await Promise.all([
        svc.from("categories").select("id, grp").eq("household_id", householdId),
        svc.from("transactions").select("category_id, amount_cents").eq("household_id", householdId).is("matched_transaction_id", null).gte("booking_date", start).lt("booking_date", end),
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
      return { mes, entradas_cents: entradas, despesas_cents: despesas, mesadas_cents: mesadas, sobra_cents: entradas - despesas - mesadas };
    }
    case "gastos_por_categoria": {
      const inicio = String(input.inicio ?? "");
      const fim = String(input.fim ?? "");
      const { data: cats } = await svc.from("categories").select("id, name").eq("household_id", householdId);
      const nameById = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
      const { data: txs } = await svc.from("transactions").select("category_id, amount_cents").eq("household_id", householdId).is("matched_transaction_id", null).gte("booking_date", inicio).lt("booking_date", fim);
      const byCat = new Map<string, number>();
      for (const t of txs ?? []) {
        if (!t.category_id) continue;
        const nm = nameById.get(t.category_id as string) ?? "?";
        if (input.categoria && !nm.toLowerCase().includes(String(input.categoria).toLowerCase())) continue;
        const exp = Math.abs(Math.min(0, t.amount_cents));
        if (exp > 0) byCat.set(nm, (byCat.get(nm) ?? 0) + exp);
      }
      return { gastos: [...byCat.entries()].map(([categoria, cents]) => ({ categoria, cents })).sort((a, b) => b.cents - a.cents) };
    }
    case "movimentos": {
      let q = svc.from("transactions").select("booking_date, description_raw, merchant_clean, counterparty, amount_cents").eq("household_id", householdId).is("matched_transaction_id", null).order("booking_date", { ascending: false }).limit(Math.min(50, Number(input.limite) || 20));
      if (input.inicio) q = q.gte("booking_date", String(input.inicio));
      if (input.fim) q = q.lt("booking_date", String(input.fim));
      if (input.texto) {
        // Strip PostgREST filter metacharacters so the .or() can't be broken.
        const s = `%${String(input.texto).replace(/[(),*%]/g, " ").trim()}%`;
        q = q.or(`merchant_clean.ilike.${s},counterparty.ilike.${s}`);
      }
      const { data } = await q;
      // Redact IBANs + counterparty names before the description reaches the AI.
      return {
        movimentos: (data ?? []).map((t) => ({
          data: t.booking_date,
          descricao: redactForAI(t.merchant_clean || displayMerchant(t.description_raw), t.counterparty),
          cents: t.amount_cents,
        })),
      };
    }
    case "eventos": {
      let q = svc.from("events").select("date, type, client_name, service_cents, status").eq("household_id", householdId).order("date", { ascending: false });
      if (input.inicio) q = q.gte("date", String(input.inicio));
      if (input.fim) q = q.lt("date", String(input.fim));
      if (input.estado) q = q.eq("status", String(input.estado));
      const { data } = await q;
      // Send only the client's first name, not the full name.
      return {
        eventos: (data ?? []).map((e) => ({
          ...e,
          client_name: e.client_name ? String(e.client_name).split(/\s+/)[0] : null,
        })),
      };
    }
    case "objetivos": {
      const { data } = await svc.from("goals").select("name, target_cents, reserved_cents, due_date").eq("household_id", householdId);
      return { objetivos: data ?? [] };
    }
    case "almofada": {
      const { data: acc } = await svc.from("accounts").select("balance_cents, balance_at").eq("household_id", householdId).eq("role", "casa").maybeSingle();
      const { data: snap } = await svc.from("monthly_snapshots").select("month, metrics").eq("household_id", householdId).order("month", { ascending: false }).limit(1).maybeSingle();
      return { saldo_conta_casa_cents: acc?.balance_cents ?? null, saldo_em: acc?.balance_at ?? null, ultimo_fecho: snap ?? null };
    }
    default:
      return { erro: "ferramenta desconhecida" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY não configurada" }, 500);

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);

    const { question } = await req.json().catch(() => ({}));
    if (!question) return json({ error: "pergunta em falta" }, 400);

    const svc = serviceClient();
    const today = new Date().toISOString().slice(0, 10);
    const system = `És o assistente financeiro de um casal (João e Joana) em Portugal.
Hoje é ${today}. Responde em português de Portugal, de forma curta e directa, com
valores em euros (os dados vêm em cêntimos — divide por 100). Usa as ferramentas
para ir buscar dados reais; resolve datas relativas ("este ano", "maio") tu próprio.
Nunca inventes números.`;

    const messages: unknown[] = [{ role: "user", content: String(question) }];

    for (let step = 0; step < 6; step++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages }),
      });
      if (!res.ok) return json({ error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 500);
      const data = await res.json();
      const content = data.content ?? [];

      if (data.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content });
        const results = [];
        for (const block of content) {
          if (block.type === "tool_use") {
            const out = await runTool(svc, ctx.householdId, block.name, block.input ?? {});
            results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
          }
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      const text = content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
      return json({ answer: text || "Não consegui responder a isso." });
    }
    return json({ answer: "A pergunta ficou demasiado complexa. Tenta reformular." });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
