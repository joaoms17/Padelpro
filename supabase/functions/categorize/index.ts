// categorize — classify uncategorized movements for a household.
// Order: user rules → mesadas → history → AI (Gemini or Claude, spec 6.2).
// Confidence < 0.7 leaves the movement uncategorized (Por rever).
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import {
  classifyLocal,
  normalizeMerchant,
  displayMerchant,
  redactForAI,
  AI_CONFIDENCE_THRESHOLD,
  type Rule,
  type MesadaRule,
} from "../_shared/categorize.ts";
import { categorizeWithAI, type AICatItem } from "../_shared/ai.ts";
import { LLMError } from "../_shared/llm.ts";

const AI_CHUNK = 25;

interface Tx {
  id: string;
  description_raw: string | null;
  counterparty: string | null;
  amount_cents: number;
  booking_date: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

    // Load everything the engine needs.
    const [uncatRes, rulesRes, catsRes, membersRes, histRes] = await Promise.all([
      svc
        .from("transactions")
        .select("id, description_raw, counterparty, amount_cents, booking_date")
        .eq("household_id", householdId)
        .is("category_id", null)
        .order("booking_date", { ascending: false })
        .limit(400),
      svc.from("rules").select("field, match_type, pattern, category_id, priority").eq("household_id", householdId),
      svc.from("categories").select("id, name, grp").eq("household_id", householdId).eq("archived", false),
      svc.from("members").select("display_name, mesada_cents, mesada_day").eq("household_id", householdId),
      svc
        .from("transactions")
        .select("description_raw, category_id, booking_date")
        .eq("household_id", householdId)
        .not("category_id", "is", null)
        // Only user-confirmed categories count as history — never AI guesses,
        // so a wrong AI guess cannot self-reinforce (spec: "última confirmada").
        .in("category_source", ["manual", "rule", "mesada"])
        .order("booking_date", { ascending: false })
        .limit(1000),
    ]);

    const uncategorized = (uncatRes.data ?? []) as Tx[];
    const rules = (rulesRes.data ?? []) as Rule[];
    const categories = (catsRes.data ?? []) as { id: string; name: string; grp: string }[];

    // Mesadas: map each member to the mesada category whose name mentions them.
    const mesadas: MesadaRule[] = [];
    for (const m of membersRes.data ?? []) {
      if (!m.mesada_cents || m.mesada_cents <= 0) continue;
      const cat = categories.find(
        (c) => c.grp === "mesada" && c.name.toLowerCase().includes(String(m.display_name).toLowerCase()),
      );
      if (cat) mesadas.push({ category_id: cat.id, mesada_cents: m.mesada_cents, mesada_day: m.mesada_day });
    }

    // History: most recent confirmed category per normalized merchant.
    const history = new Map<string, string>();
    for (const h of histRes.data ?? []) {
      const key = normalizeMerchant(h.description_raw);
      if (key && !history.has(key)) history.set(key, h.category_id as string);
    }

    const ctx = { rules, mesadas, history };
    const updates: { id: string; category_id: string | null; category_source: string | null; confidence: number; merchant_clean: string }[] = [];
    const aiItems: AICatItem[] = [];

    const cleanById = new Map<string, string>();
    for (const tx of uncategorized) {
      const merchant_clean = displayMerchant(tx.description_raw);
      cleanById.set(tx.id, merchant_clean);
      const local = classifyLocal(tx, ctx);
      if (local) {
        updates.push({ id: tx.id, category_id: local.category_id, category_source: local.source, confidence: local.confidence, merchant_clean });
      } else {
        // Redact IBANs and the counterparty name before anything leaves the
        // device for the AI (spec 6.2).
        aiItems.push({
          id: tx.id,
          description: redactForAI(merchant_clean, tx.counterparty) || "movimento",
          amount_eur: Math.round(tx.amount_cents) / 100,
          date: tx.booking_date,
        });
      }
    }

    // AI step, in chunks.
    let aiAssigned = 0;
    let aiReview = 0;
    let aiError: string | null = null;
    for (let i = 0; i < aiItems.length; i += AI_CHUNK) {
      const chunk = aiItems.slice(i, i + AI_CHUNK);
      let results: Awaited<ReturnType<typeof categorizeWithAI>> = [];
      // After a quota/availability failure, don't spend more calls: the rest
      // simply stays "Por rever" until the next run.
      if (!aiError) {
        try {
          results = await categorizeWithAI(chunk, categories);
        } catch (e) {
          if (e instanceof LLMError) aiError = e.message;
          results = [];
        }
      }
      const byId = new Map(results.map((r) => [r.id, r]));
      for (const it of chunk) {
        const r = byId.get(it.id);
        // Store the real (unredacted) display name, not the AI-redacted string.
        const merchant_clean = cleanById.get(it.id) ?? it.description;
        if (r && r.category_id && r.confidence >= AI_CONFIDENCE_THRESHOLD) {
          updates.push({ id: it.id, category_id: r.category_id, category_source: "ai", confidence: r.confidence, merchant_clean });
          aiAssigned++;
        } else {
          // leave uncategorized (Por rever) but store the clean name + confidence
          updates.push({ id: it.id, category_id: null, category_source: r ? "ai" : null, confidence: r?.confidence ?? 0, merchant_clean });
          aiReview++;
        }
      }
    }

    // Persist in chunks, conditionally (only rows still uncategorized, so we
    // never clobber a category set concurrently) and tolerant of row failures.
    const CHUNK = 25;
    let persisted = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const batch = updates.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        batch.map((u) =>
          svc
            .from("transactions")
            .update({
              category_id: u.category_id,
              category_source: u.category_source,
              confidence: u.confidence,
              merchant_clean: u.merchant_clean,
              updated_at: new Date().toISOString(),
            })
            .eq("id", u.id)
            .is("category_id", null),
        ),
      );
      persisted += settled.filter(
        (r) => r.status === "fulfilled" && !(r.value as { error?: unknown }).error,
      ).length;
    }

    const assigned = updates.filter((u) => u.category_id).length;
    return json({
      processed: uncategorized.length,
      assigned,
      persisted,
      review: uncategorized.length - assigned,
      ai_assigned: aiAssigned,
      ai_review: aiReview,
      ai_error: aiError,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
