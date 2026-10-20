// Categorization engine — pure, deterministic, testable (no Deno/Supabase).
// Order (spec 6.2): user rules → mesadas → history → (AI, done in the Edge
// Function). Confidence < 0.7 means "Por rever".

export type RuleField = "merchant" | "description" | "counterparty" | "iban";
export type MatchType = "equals" | "contains" | "regex";
export type CategorySource = "rule" | "mesada" | "history" | "ai" | "manual";

export interface Rule {
  field: RuleField;
  match_type: MatchType;
  pattern: string;
  category_id: string;
  priority: number; // lower runs first
}

export interface TxLite {
  description_raw: string | null;
  counterparty: string | null;
  amount_cents: number;
  booking_date: string; // ISO
}

export interface MesadaRule {
  category_id: string;
  mesada_cents: number;
  mesada_day: number | null;
}

export interface Assignment {
  category_id: string;
  source: CategorySource;
  confidence: number;
}

// Prefixes and noise the bank prepends to the real merchant name.
const PREFIXES = [
  "compras em",
  "compra em",
  "compras",
  "compra",
  "pagamento de servico",
  "pagamento servico",
  "pagamento",
  "pag.",
  "pag ",
  "mb way",
  "mbway",
  "mb ",
  "transferencia sepa",
  "transferencia",
  "trf.",
  "trf ",
  "deb dir",
  "debito directo",
  "debito direto",
  "levantamento",
  "compra c/ cartao",
  "compra cartao",
];

// Longest first so "compra c/ cartao" is stripped before the shorter "compra".
const PREFIXES_BY_LEN = [...PREFIXES].sort((a, b) => b.length - a.length);

/** Normalise a bank description down to a stable merchant key. */
export function normalizeMerchant(desc: string | null): string {
  if (!desc) return "";
  let s = desc.toLowerCase();

  // redact IBAN-like tokens (country code + check digits + body) entirely, then
  // strip card numbers, long digit codes, dates, times
  s = s
    .replace(/\b[a-z]{2}\d{2}[a-z0-9]{8,}\b/gi, " ") // IBAN (e.g. PT50…)
    .replace(/\b\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?\b/g, " ") // dates
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ") // times
    .replace(/\bx{2,}\d+\b/gi, " ") // masked card like xxxx1234
    .replace(/\b\d+\b/g, " "); // standalone numbers (store codes, card fragments)

  // strip known prefixes (possibly several), longest match first
  let changed = true;
  while (changed) {
    changed = false;
    const t = s.trimStart();
    for (const p of PREFIXES_BY_LEN) {
      if (t.startsWith(p)) {
        s = t.slice(p.length);
        changed = true;
        break;
      }
    }
  }

  // drop punctuation, collapse whitespace
  s = s
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

/**
 * Redact a merchant string before it leaves the device for the AI: remove any
 * IBAN-like tokens and the counterparty's name tokens (spec 6.2: "sem IBANs
 * nem nomes completos"). Used only for the AI payload, never for storage keys.
 */
export function redactForAI(text: string, counterparty: string | null): string {
  let s = ` ${text.toLowerCase()} `
    .replace(/\b[a-z]{2}\d{2}[a-z0-9]{6,}\b/gi, " ")
    .replace(/\b[a-z]{2}\d{2}\b/gi, " "); // stray IBAN prefix like "pt50"
  if (counterparty) {
    for (const tok of counterparty.toLowerCase().split(/\s+/)) {
      if (tok.length >= 3) {
        s = s.replace(new RegExp(`\\b${tok.replace(/[^\p{L}\p{N}]/gu, "")}\\b`, "giu"), " ");
      }
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Title-case the normalized merchant for display. */
export function displayMerchant(desc: string | null): string {
  const n = normalizeMerchant(desc);
  if (!n) return "";
  return n
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Words that say nothing about the merchant: card/foreign-purchase markers,
// web prefixes, legal forms and country names.
const NOISE_WORDS = new Set([
  "estrang", "estrangeiro", "www", "http", "https", "com", "net", "org", "pt",
  "eu", "sa", "lda", "unipessoal", "sl", "ltd", "inc", "gmbh", "bv", "portugal",
  "lisboa", "porto", "europe", "intl", "online", "store", "shop", "pay", "payments",
  "es", "de", "fr", "it", "uk", "nl", "ie", "us", "co", "mktp", "marketplace",
]);

/** Normalise a user-typed rule keyword the same way descriptions are. */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const keep = (w: string) => w.length > 1 && !/\d/.test(w) && !NOISE_WORDS.has(w);

/**
 * Suggest the part of a description worth matching on for an "always apply"
 * rule: the first run of consecutive meaningful words (max 3), skipping
 * reference codes and noise words. It is always a substring of the normalised
 * description, so the rule matches the movement it was made from:
 * "Estrang Www Amazon Nk8yt9dq4" → "amazon", "UBER *EATS PORTUGAL" → "uber eats".
 * Empty when nothing usable is left (e.g. an MB WAY to a phone number).
 */
export function suggestRuleKeyword(desc: string | null): string {
  const words = normalizeMerchant(desc).split(" ");
  const start = words.findIndex(keep);
  if (start < 0) return "";
  const run: string[] = [];
  for (let i = start; i < words.length && run.length < 3 && keep(words[i]); i++) run.push(words[i]);
  return run.join(" ");
}

/** A keyword specific enough to be a rule (at least 3 letters, not just noise). */
export function isUsableKeyword(keyword: string): boolean {
  const k = normalizeKeyword(keyword);
  return (k.match(/\p{L}/gu)?.length ?? 0) >= 3 && k.split(" ").some(keep);
}

/** Does a description match a "contains" keyword rule (merchant field)? */
export function matchesKeyword(desc: string | null, keyword: string): boolean {
  const k = normalizeKeyword(keyword);
  return !!k && normalizeMerchant(desc).includes(k);
}

function fieldValue(tx: TxLite, field: RuleField): string {
  switch (field) {
    case "merchant":
      return normalizeMerchant(tx.description_raw);
    case "description":
      return (tx.description_raw ?? "").toLowerCase();
    case "counterparty":
      return (tx.counterparty ?? "").toLowerCase();
    case "iban":
      return ""; // IBANs are stored hashed; not matchable here
  }
}

function ruleMatches(tx: TxLite, rule: Rule): boolean {
  const value = fieldValue(tx, rule.field);
  if (!value) return false;
  const pat = rule.pattern.toLowerCase();
  switch (rule.match_type) {
    case "equals":
      return value === pat;
    case "contains":
      return value.includes(pat);
    case "regex":
      // Guard against pathological patterns (self-inflicted ReDoS): cap sizes.
      if (rule.pattern.length > 200 || value.length > 1000) return false;
      try {
        return new RegExp(rule.pattern, "i").test(value);
      } catch {
        return false;
      }
  }
}

export function matchRules(tx: TxLite, rules: Rule[]): string | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(tx, r)) return r.category_id;
  }
  return null;
}

/** A mesada: a debit near the configured day whose value equals the mesada. */
export function matchMesada(
  tx: TxLite,
  mesadas: MesadaRule[],
  dayTolerance = 3,
): string | null {
  if (tx.amount_cents >= 0) return null;
  const abs = Math.abs(tx.amount_cents);
  const day = Number(tx.booking_date.slice(8, 10));
  for (const m of mesadas) {
    if (m.mesada_cents <= 0 || abs !== m.mesada_cents) continue;
    if (m.mesada_day == null) return m.category_id;
    if (Math.abs(day - m.mesada_day) <= dayTolerance) return m.category_id;
  }
  return null;
}

export function matchHistory(
  tx: TxLite,
  history: Map<string, string>,
): string | null {
  const key = normalizeMerchant(tx.description_raw);
  if (!key) return null;
  return history.get(key) ?? null;
}

export interface ClassifyContext {
  rules: Rule[];
  mesadas: MesadaRule[];
  history: Map<string, string>;
}

/** Local (non-AI) classification. Returns null when the AI step is needed. */
export function classifyLocal(
  tx: TxLite,
  ctx: ClassifyContext,
): Assignment | null {
  const byRule = matchRules(tx, ctx.rules);
  if (byRule) return { category_id: byRule, source: "rule", confidence: 1 };

  const byMesada = matchMesada(tx, ctx.mesadas);
  if (byMesada) return { category_id: byMesada, source: "mesada", confidence: 1 };

  const byHistory = matchHistory(tx, ctx.history);
  if (byHistory) return { category_id: byHistory, source: "history", confidence: 1 };

  return null;
}

export const AI_CONFIDENCE_THRESHOLD = 0.7;
