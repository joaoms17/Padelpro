// AI task of the app (spec 6.2): batch categorisation, on whichever provider
// is configured (see llm.ts — Gemini or Claude, fast tier). Only redacted
// descriptions, amounts and dates are sent: no IBANs, no full names.
import { generateText, llmProvider } from "./llm.ts";

export interface AICatItem {
  id: string;
  description: string; // normalized merchant (no IBANs, no full names)
  amount_eur: number;
  date: string;
}

export interface AICatResult {
  id: string;
  category_id: string | null;
  confidence: number;
}

export interface CategoryOption {
  id: string;
  name: string;
  grp: string;
}

function extractJson(text: string): AICatResult[] {
  const fence = text.replace(/```(?:json)?/gi, "").trim();
  // Try a clean array parse first.
  const start = fence.indexOf("[");
  const end = fence.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(fence.slice(start, end + 1)) as AICatResult[];
    } catch {
      /* fall through to tolerant per-object parse (handles truncation) */
    }
  }
  // Tolerant: parse each complete {...} object we can find.
  const out: AICatResult[] = [];
  for (const m of fence.matchAll(/\{[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(m[0]) as AICatResult);
    } catch {
      /* skip malformed fragment */
    }
  }
  return out;
}

/** Classify a batch of movements. Returns one result per input item. */
export async function categorizeWithAI(
  items: AICatItem[],
  categories: CategoryOption[],
): Promise<AICatResult[]> {
  if (!llmProvider() || items.length === 0 || categories.length === 0) return [];

  const catList = categories
    .map((c) => `- ${c.id} :: ${c.name} (${c.grp})`)
    .join("\n");

  const prompt = `És um categorizador de movimentos bancários de um casal em Portugal.
Para cada movimento, escolhe a categoria MAIS provável da lista. Responde APENAS
com um array JSON, um objeto por movimento, no formato:
[{"id": "<id do movimento>", "category_id": "<id da categoria ou null>", "confidence": <0..1>}]

Regras:
- usa só os category_id da lista; se nenhuma encaixar, category_id = null
- confidence reflete a tua certeza (0 a 1)
- valores negativos são despesas, positivos são entradas

Categorias disponíveis (id :: nome (grupo)):
${catList}

Movimentos:
${items
  .map((it) => `- id=${it.id} | "${it.description}" | ${it.amount_eur}€ | ${it.date}`)
  .join("\n")}`;

  // Gemini enforces this schema; Claude follows the prompt above.
  const jsonSchema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        category_id: { anyOf: [{ type: "string", enum: categories.map((c) => c.id) }, { type: "null" }] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["id", "category_id", "confidence"],
      propertyOrdering: ["id", "category_id", "confidence"],
    },
  };

  // A truncated answer still has complete objects: extractJson keeps them.
  const text = await generateText({ tier: "fast", prompt, maxTokens: 8192, jsonSchema, allowPartial: true });
  const parsed = extractJson(text || "[]");
  const valid = new Set(categories.map((c) => c.id));
  return parsed.map((r) => ({
    id: String(r.id),
    category_id: r.category_id && valid.has(r.category_id) ? r.category_id : null,
    confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0,
  }));
}
