// ingest-applepay — receives a tap from the iPhone Shortcut in real time.
// Auth is the member's PERSONAL token (not a Supabase JWT), so this function
// runs with verify_jwt = false (see supabase/config.toml). The token is stored
// only as a SHA-256 hash and can be revoked.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import {
  classifyLocal,
  normalizeMerchant,
  displayMerchant,
  type Rule,
  mesadaRules,
  type CategoryRow,
} from "../_shared/categorize.ts";
import { parseAppleAmount } from "../_shared/match.ts";

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "sem token" }, 401);

    const svc = serviceClient();
    const tokenHash = await sha256hex(token);
    const { data: tok } = await svc
      .from("ingest_tokens")
      .select("id, member_id, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!tok || tok.revoked_at) return json({ error: "token inválido" }, 401);

    const { data: member } = await svc
      .from("members")
      .select("household_id")
      .eq("id", tok.member_id)
      .maybeSingle();
    if (!member) return json({ error: "membro não encontrado" }, 401);
    const householdId = member.household_id as string;

    const body = await req.json().catch(() => ({}));
    const cents = parseAppleAmount(String(body.amount ?? ""));
    if (cents == null || cents <= 0) return json({ error: "valor inválido" }, 400);

    const merchant = String(body.merchant ?? "").slice(0, 140);
    const occurredAt = body.occurred_at
      ? new Date(body.occurred_at).toISOString()
      : new Date().toISOString();
    const bookingDate = occurredAt.slice(0, 10);

    // Conta Casa of this household.
    const { data: acc } = await svc
      .from("accounts")
      .select("id")
      .eq("household_id", householdId)
      .eq("role", "casa")
      .maybeSingle();
    if (!acc) return json({ error: "conta não encontrada" }, 400);

    // Best-effort local categorization (rules → mesada → history; no AI here).
    const [rulesRes, catsRes, membersRes, histRes] = await Promise.all([
      svc.from("rules").select("field, match_type, pattern, category_id, priority").eq("household_id", householdId),
      svc.from("categories").select("id, name, grp, sort, system_role").eq("household_id", householdId).eq("archived", false),
      svc.from("members").select("display_name, mesada_cents, mesada_day").eq("household_id", householdId),
      svc.from("transactions").select("description_raw, category_id").eq("household_id", householdId).not("category_id", "is", null).in("category_source", ["manual", "rule", "mesada"]).order("booking_date", { ascending: false }).limit(500),
    ]);
    const categories = (catsRes.data ?? []) as CategoryRow[];
    const mesadas = mesadaRules(categories, membersRes.data ?? []);
    const history = new Map<string, string>();
    for (const h of histRes.data ?? []) {
      const key = normalizeMerchant(h.description_raw);
      if (key && !history.has(key)) history.set(key, h.category_id as string);
    }

    const txLite = { description_raw: merchant, counterparty: null, amount_cents: -cents, booking_date: bookingDate };
    const local = classifyLocal(txLite, { rules: (rulesRes.data ?? []) as Rule[], mesadas, history });

    const { error: insErr } = await svc.from("transactions").insert({
      household_id: householdId,
      account_id: acc.id,
      source: "applepay",
      external_id: `ap:${crypto.randomUUID()}`,
      booking_date: bookingDate,
      value_date: bookingDate,
      amount_cents: -cents,
      description_raw: merchant,
      merchant_clean: displayMerchant(merchant),
      category_id: local?.category_id ?? null,
      category_source: local?.source ?? null,
      confidence: local?.confidence ?? null,
      status: "provisorio",
      created_by: null,
    });
    if (insErr) throw insErr;

    await svc.from("ingest_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
