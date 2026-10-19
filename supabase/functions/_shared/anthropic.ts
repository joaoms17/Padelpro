// Minimal Anthropic Messages API client for the categorize Edge Function.
// Model: claude-haiku-5-5 (spec 6.2 / 11). The key lives only in the Edge
// Function secrets (ANTHROPIC_API_KEY).

const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-5-5";

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

function extractJson(text: string): unknown {
  const fence = text.replace(/```(?:json)?/gi, "").trim();
  const start = fence.indexOf("[");
  const end = fence.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  return JSON.parse(fence.slice(start, end + 1));
}

/** Classify a batch of movements. Returns one result per input item. */
export async function categorizeWithAI(
  items: AICatItem[],
  categories: CategoryOption[],
): Promise<AICatResult[]> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || items.length === 0) return [];

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

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "[]";
  const parsed = extractJson(text) as AICatResult[];
  const valid = new Set(categories.map((c) => c.id));
  return parsed.map((r) => ({
    id: String(r.id),
    category_id: r.category_id && valid.has(r.category_id) ? r.category_id : null,
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
  }));
}
