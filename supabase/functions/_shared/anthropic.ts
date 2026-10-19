// Minimal Anthropic Messages API client for the categorize Edge Function.
// Model: claude-haiku-5-5 (spec 6.2 / 11). The key lives only in the Edge
// Function secrets (ANTHROPIC_API_KEY).

const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-5-5";

/** Friendly month-close summary (spec 11). Returns "" if no key configured. */
export async function summarizeMonth(metrics: Record<string, number | null>): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return "";
  const prompt = `És o assistente de finanças de um casal (João e Joana) em Portugal.
Escreve um resumo curto e simpático (2-3 frases, PT-PT) do fecho do mês, com o
que correu bem, o que fugiu ao esperado e uma sugestão prática. Valores em cêntimos:
${JSON.stringify(metrics)}
Responde só com o texto, sem markdown.`;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data?.content?.[0]?.text ?? "").trim();
  } catch {
    return "";
  }
}

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
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || items.length === 0 || categories.length === 0) return [];

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
      max_tokens: 4096,
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
