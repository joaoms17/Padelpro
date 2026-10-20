// Provider-neutral LLM calls for the Edge Functions (plain fetch, no SDK).
// The provider is picked by which key is in the function secrets:
//   GEMINI_API_KEY    → Google Gemini (free tier in Google AI Studio)
//   ANTHROPIC_API_KEY → Anthropic Claude
// Model ids can be overridden with GEMINI_MODEL_FAST / GEMINI_MODEL_SMART /
// ANTHROPIC_MODEL_FAST / ANTHROPIC_MODEL_SMART (names change often).
// Keys live only here, never in the PWA.

export type Provider = "gemini" | "anthropic";
export type Tier = "fast" | "smart";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

const DEFAULT_MODELS: Record<Provider, Record<Tier, string>> = {
  gemini: { fast: "gemini-3.5-flash-lite", smart: "gemini-3.8-flash" },
  anthropic: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" },
};

export function llmProvider(): Provider | null {
  if (Deno.env.get("GEMINI_API_KEY")) return "gemini";
  if (Deno.env.get("ANTHROPIC_API_KEY")) return "anthropic";
  return null;
}

export function modelFor(provider: Provider, tier: Tier): string {
  const env = `${provider.toUpperCase()}_MODEL_${tier.toUpperCase()}`;
  return Deno.env.get(env) || DEFAULT_MODELS[provider][tier];
}

/** An LLM failure with a message the app can show as-is. */
export class LLMError extends Error {
  constructor(
    message: string,
    /** Daily quota gone, model missing or overloaded: worth trying a lighter model. */
    readonly fallback = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export interface ToolDef {
  name: string;
  description: string;
  /** Omitted for tools without arguments. */
  params?: {
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export type RunTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

// ───────────────────────── Gemini ─────────────────────────

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  [k: string]: unknown;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geminiCall(model: string, body: Record<string, unknown>): Promise<GeminiResponse> {
  const key = Deno.env.get("GEMINI_API_KEY")!;
  let req = body;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${GEMINI_API}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.ok) return await res.json() as GeminiResponse;

    const text = await res.text();
    let err: { message?: string; status?: string; details?: Record<string, unknown>[] } = {};
    try {
      err = (JSON.parse(text) as { error?: typeof err }).error ?? {};
    } catch (_e) {
      /* non-JSON error body */
    }
    const msg = err.message ?? text.slice(0, 200);
    const details = err.details ?? [];

    // Some models reject a thinking level they don't support: drop it once.
    const gen = req.generationConfig as Record<string, unknown> | undefined;
    if (res.status === 400 && gen?.thinkingConfig && /thinking/i.test(msg)) {
      const { thinkingConfig: _t, ...rest } = gen;
      req = { ...req, generationConfig: rest };
      continue;
    }
    // Structured output schema not accepted by this model: the prompt also
    // asks for the format, so retry once without the schema.
    if (res.status === 400 && gen?.responseJsonSchema && /schema/i.test(msg)) {
      const { responseJsonSchema: _s, ...rest } = gen;
      req = { ...req, generationConfig: rest };
      continue;
    }
    if (res.status === 429) {
      const perDay = details.some((d) =>
        JSON.stringify(d.violations ?? "").includes("PerDay")
      );
      if (perDay || attempt === 2) {
        throw new LLMError(
          perDay
            ? `A quota grátis diária do Gemini (${model}) esgotou — volta por volta das 8h.`
            : `Demasiados pedidos ao Gemini (${model}) — tenta daqui a um minuto.`,
          true,
        );
      }
      const retry = details.find((d) => typeof d.retryDelay === "string")?.retryDelay as string | undefined;
      const secs = retry ? Number.parseFloat(retry) : 2 ** (attempt + 1);
      await sleep(Math.min(20, Number.isFinite(secs) ? secs : 4) * 1000);
      continue;
    }
    if ([500, 502, 503, 504].includes(res.status) && attempt < 2) {
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }
    if (res.status === 404) throw new LLMError(`O modelo ${model} não está disponível para esta chave.`, true);
    if ([500, 502, 503, 504].includes(res.status)) {
      throw new LLMError(`O Gemini está sobrecarregado (${res.status}) — tenta mais tarde.`, true);
    }
    if (res.status === 400 && /API_KEY_INVALID|API key/i.test(text)) {
      throw new LLMError("A chave GEMINI_API_KEY é inválida.");
    }
    throw new LLMError(`Gemini ${res.status}: ${msg}`);
  }
  throw new LLMError("O Gemini não respondeu.", true);
}

function geminiText(data: GeminiResponse): string {
  const c = data.candidates?.[0];
  if (!c) throw new LLMError(`O Gemini recusou o pedido (${data.promptFeedback?.blockReason ?? "sem resposta"}).`);
  const text = (c.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  if (c.finishReason && c.finishReason !== "STOP") {
    throw new LLMError(`Resposta do Gemini incompleta (${c.finishReason}).`);
  }
  return text;
}

async function geminiGenerate(
  tier: Tier,
  system: string | undefined,
  prompt: string,
  opts: { maxTokens: number; jsonSchema?: Record<string, unknown> },
): Promise<string> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: opts.maxTokens,
    // Thinking counts against maxOutputTokens: keep it low for these tasks.
    thinkingConfig: { thinkingLevel: "LOW" },
  };
  if (opts.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = opts.jsonSchema;
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return geminiText(await geminiCall(modelFor("gemini", tier), body));
}

function geminiTools(tools: ToolDef[]) {
  return [{
    functionDeclarations: tools.map((t) =>
      // An OBJECT schema with no properties is rejected: omit parameters.
      t.params && Object.keys(t.params.properties).length
        ? {
          name: t.name,
          description: t.description,
          parameters: { type: "object", properties: t.params.properties, required: t.params.required ?? [] },
        }
        : { name: t.name, description: t.description }
    ),
  }];
}

async function geminiChat(
  model: string,
  system: string,
  question: string,
  tools: ToolDef[],
  run: RunTool,
  maxSteps: number,
): Promise<string> {
  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: question }] }];
  for (let step = 0; step < maxSteps; step++) {
    const last = step === maxSteps - 1;
    const data = await geminiCall(model, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: geminiTools(tools),
      // On the last step force a text answer.
      toolConfig: { functionCallingConfig: { mode: last ? "NONE" : "AUTO" } },
      // Google recommends medium thinking for tool use (esp. on Flash-Lite);
      // thinking counts against maxOutputTokens, hence the generous ceiling.
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "MEDIUM" } },
    });
    const cand = data.candidates?.[0];
    const calls = (cand?.content?.parts ?? []).filter((p) => p.functionCall);
    if (!cand?.content || calls.length === 0) return geminiText(data);

    // Echo the model turn unchanged: it carries the thought signatures
    // Gemini 3+ requires on function-calling turns.
    contents.push(cand.content);
    const responses = await Promise.all(calls.map(async (p) => {
      const fc = p.functionCall!;
      let result: unknown;
      try {
        result = await run(fc.name, fc.args ?? {});
      } catch (e) {
        result = { erro: e instanceof Error ? e.message : String(e) };
      }
      return {
        functionResponse: {
          name: fc.name,
          ...(fc.id ? { id: fc.id } : {}),
          response: { result },
        },
      };
    }));
    contents.push({ role: "user", parts: responses });
  }
  return "";
}

// ───────────────────────── Anthropic ─────────────────────────

async function anthropicCall(body: Record<string, unknown>): Promise<{
  content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
  stop_reason?: string;
}> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new LLMError(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status === 429 || res.status >= 500);
  }
  return await res.json();
}

async function anthropicChat(
  system: string,
  question: string,
  tools: ToolDef[],
  run: RunTool,
  maxSteps: number,
): Promise<string> {
  const messages: unknown[] = [{ role: "user", content: question }];
  const defs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: "object", properties: t.params?.properties ?? {}, required: t.params?.required ?? [] },
  }));
  for (let step = 0; step < maxSteps; step++) {
    const data = await anthropicCall({
      model: modelFor("anthropic", "smart"),
      max_tokens: 1024,
      system,
      tools: defs,
      messages,
    });
    const content = data.content ?? [];
    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content });
      const results = [];
      for (const block of content) {
        if (block.type === "tool_use") {
          const out = await run(block.name!, block.input ?? {});
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    return content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }
  return "";
}

// ───────────────────────── Public API ─────────────────────────

/** One-shot text generation (optionally constrained to a JSON schema). */
export async function generateText(opts: {
  tier: Tier;
  prompt: string;
  system?: string;
  maxTokens: number;
  /** JSON Schema of the expected answer (Gemini enforces it; Claude follows the prompt). */
  jsonSchema?: Record<string, unknown>;
}): Promise<string> {
  const provider = llmProvider();
  if (!provider) throw new LLMError("Nenhuma chave de IA configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY).");
  if (provider === "gemini") {
    return await geminiGenerate(opts.tier, opts.system, opts.prompt, opts);
  }
  const data = await anthropicCall({
    model: modelFor("anthropic", opts.tier),
    max_tokens: opts.maxTokens,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.prompt }],
  });
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

/**
 * Tool-using chat: the model calls `run` for read-only tools until it can
 * answer. On Gemini the stronger model is tried first and, if its (small)
 * free quota is gone or it is unavailable, the fast model answers instead.
 */
export async function chatWithTools(opts: {
  system: string;
  question: string;
  tools: ToolDef[];
  run: RunTool;
  maxSteps?: number;
}): Promise<string> {
  const provider = llmProvider();
  if (!provider) throw new LLMError("Nenhuma chave de IA configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY).");
  const steps = opts.maxSteps ?? 6;
  if (provider === "anthropic") return await anthropicChat(opts.system, opts.question, opts.tools, opts.run, steps);

  const smart = modelFor("gemini", "smart");
  const fast = modelFor("gemini", "fast");
  try {
    return await geminiChat(smart, opts.system, opts.question, opts.tools, opts.run, steps);
  } catch (e) {
    if (!(e instanceof LLMError && e.fallback) || smart === fast) throw e;
    return await geminiChat(fast, opts.system, opts.question, opts.tools, opts.run, steps);
  }
}
