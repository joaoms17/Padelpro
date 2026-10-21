// Categorize a household's uncategorized movements.
// Order: user rules → mesadas → history → known shops, incomes and names
// (a suggestion to confirm) → AI (Gemini or Claude, spec 6.2). Used by the
// categorize function (on demand) and by eb-sync (after each bank sync).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  classifyLocal,
  normalizeMerchant,
  displayMerchant,
  redactForAI,
  AI_CONFIDENCE_THRESHOLD,
  type Rule,
  mesadaRules,
  type CategoryRow,
} from "./categorize.ts";
import { makeSuggester, type SuggestIncome } from "./suggest.ts";
import { categorizeWithAI, type AICatItem } from "./ai.ts";
import { LLMError } from "./llm.ts";

const AI_CHUNK = 25;

/** Shown as "por validar" in the app until someone confirms it. */
export const SUGGESTION_SOURCE = "sugestao";
const SUGGESTION_CONFIDENCE = 0.8;

interface Tx {
  id: string;
  description_raw: string | null;
  counterparty: string | null;
  amount_cents: number;
  booking_date: string;
}

export interface CategorizeResult {
  processed: number;
  assigned: number;
  suggested: number;
  persisted: number;
  review: number;
  ai_assigned: number;
  ai_review: number;
  ai_error: string | null;
  ai_pending: number;
}

export async function categorizeHousehold(
  svc: SupabaseClient,
  householdId: string,
  opts: { ai: boolean; aiDeadline: number },
): Promise<CategorizeResult> {
  const [uncatRes, rulesRes, catsRes, membersRes, histRes, incRes] = await Promise.all([
    svc
      .from("transactions")
      .select("id, description_raw, counterparty, amount_cents, booking_date")
      .eq("household_id", householdId)
      .is("category_id", null)
      // Apple Pay notes already matched to a bank movement are done; a category
      // someone cleared on purpose (source manual) stays cleared.
      .is("matched_transaction_id", null)
      .or("category_source.is.null,category_source.neq.manual")
      .order("booking_date", { ascending: false })
      .limit(400),
    svc.from("rules").select("field, match_type, pattern, category_id, priority").eq("household_id", householdId),
    svc.from("categories").select("id, name, grp, sort, system_role").eq("household_id", householdId).eq("archived", false),
    svc.from("members").select("id, display_name, mesada_cents, mesada_day").eq("household_id", householdId),
    svc
      .from("transactions")
      .select("description_raw, category_id, booking_date")
      .eq("household_id", householdId)
      .not("category_id", "is", null)
      // Only user-confirmed categories count as history — never AI guesses or
      // suggestions, so a wrong guess cannot self-reinforce.
      .in("category_source", ["manual", "rule", "mesada"])
      .order("booking_date", { ascending: false })
      .limit(1000),
    svc.from("expected_incomes").select("label, match_text, amount_cents, parts, kind, active").eq("household_id", householdId),
  ]);

  const uncategorized = (uncatRes.data ?? []) as Tx[];
  const rules = (rulesRes.data ?? []) as Rule[];
  const categories = (catsRes.data ?? []) as CategoryRow[];
  const members = (membersRes.data ?? []) as { id: string; display_name: string | null; mesada_cents: number | null; mesada_day: number | null }[];

  // Mesadas: map each member to the mesada category whose name mentions them.
  const mesadas = mesadaRules(categories, members);

  // History: most recent confirmed category per normalized merchant.
  const history = new Map<string, string>();
  for (const h of histRes.data ?? []) {
    const key = normalizeMerchant(h.description_raw);
    if (key && !history.has(key)) history.set(key, h.category_id as string);
  }

  const suggest = makeSuggester({
    categories,
    members,
    // Without a stored kind (or before migration 0015) it is guessed from the name.
    incomes: ((incRes.data ?? []) as SuggestIncome[]),
  });

  const ctx = { rules, mesadas, history };
  const updates: { id: string; category_id: string | null; category_source: string | null; confidence: number; merchant_clean: string }[] = [];
  const aiItems: AICatItem[] = [];
  let suggested = 0;

  const cleanById = new Map<string, string>();
  for (const tx of uncategorized) {
    const merchant_clean = displayMerchant(tx.description_raw);
    cleanById.set(tx.id, merchant_clean);
    const local = classifyLocal(tx, ctx);
    if (local) {
      updates.push({ id: tx.id, category_id: local.category_id, category_source: local.source, confidence: local.confidence, merchant_clean });
      continue;
    }
    const s = suggest(tx);
    if (s) {
      updates.push({ id: tx.id, category_id: s.category_id, category_source: SUGGESTION_SOURCE, confidence: SUGGESTION_CONFIDENCE, merchant_clean });
      suggested++;
      continue;
    }
    // Without the AI step the row is left exactly as it is.
    if (!opts.ai) continue;
    // Redact IBANs and the counterparty name before anything leaves the
    // device for the AI (spec 6.2).
    aiItems.push({
      id: tx.id,
      description: redactForAI(merchant_clean, tx.counterparty) || "movimento",
      amount_eur: Math.round(tx.amount_cents) / 100,
      date: tx.booking_date,
    });
  }

  // AI step, in chunks.
  let aiAssigned = 0;
  let aiReview = 0;
  let aiError: string | null = null;
  let aiPending = 0;
  for (let i = 0; i < aiItems.length; i += AI_CHUNK) {
    const chunk = aiItems.slice(i, i + AI_CHUNK);
    let results: Awaited<ReturnType<typeof categorizeWithAI>> = [];
    if (Date.now() > opts.aiDeadline) {
      aiPending += chunk.length;
      continue;
    }
    // After a quota/availability failure, don't spend more calls: the rest
    // simply stays uncategorized until the next run.
    if (!aiError) {
      try {
        results = await categorizeWithAI(chunk, categories);
      } catch (e) {
        // Quota / overload / missing model / timeout / bad key: stop for
        // this run. A problem with this batch only (blocked, malformed): skip it.
        if (e instanceof LLMError && (e.fallback || e.fatal)) aiError = e.message;
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
        // leave uncategorized but store the clean name + confidence
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
  return {
    processed: uncategorized.length,
    assigned,
    suggested,
    persisted,
    review: uncategorized.length - assigned,
    ai_assigned: aiAssigned,
    ai_review: aiReview,
    ai_error: aiError,
    ai_pending: aiPending,
  };
}
