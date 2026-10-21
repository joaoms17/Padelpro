// Movimentos: grouping for fast categorization ("Por categorizar") and for
// confirming what the app filed by itself ("Por validar"). Pure and testable.
import { isTransfer, memberCategory, plain, slotCategory, type SuggestCategoryRow, type SuggestMember } from "@shared/suggest";
import { isUsableKeyword, normalizeMerchant, suggestRuleKeyword } from "@shared/categorize";

export interface TriageTx {
  id: string;
  booking_date: string;
  amount_cents: number;
  description_raw: string | null;
}

export interface TriageGroup<T extends TriageTx = TriageTx> {
  key: string;
  /** What "Aplicar também aos próximos" matches ("" when nothing usable). */
  keyword: string;
  /** The group's name (e.g. "Uber Eats"). */
  label: string;
  /** Newest first. */
  rows: T[];
  /** Σ |amount|. */
  totalCents: number;
  /** Σ amount (negative: money out). */
  netCents: number;
  /** Every row is a bank transfer or MB WAY (to or from someone). */
  transfer: boolean;
  /** For transfers: money came in (true) or went out (false). */
  incoming: boolean;
  /** The most common suggested category among the rows. */
  suggestion: string | null;
}

// Words of a transfer description that say nothing about who it is with.
const TRANSFER_WORDS = new Set([
  "trf", "transf", "transferencia", "transferencias", "imed", "imediata", "inst", "instantanea", "cred", "credito",
  "deb", "debito", "sepa", "mb", "way", "mbway", "ord", "ordem", "ref", "para", "de", "da", "do", "das", "dos",
  "pt", "sa", "lda", "unipessoal",
]);

const meaningful = (w: string) => w.length > 1 && !/\d/.test(w) && !TRANSFER_WORDS.has(plain(w));

/**
 * The part of a transfer's description that names the other side
 * ("TRF IMED P/ JOAO MANUEL SILVA" → "joao manuel silva"): the first run of
 * up to 3 meaningful words of the normalised description, so a rule made from
 * it matches the movement. Without it, every "TRF IMED …" would be one group
 * (and one rule).
 */
export function transferKeyword(desc: string | null): string {
  const words = normalizeMerchant(desc).split(" ");
  const start = words.findIndex(meaningful);
  if (start < 0) return "";
  const run: string[] = [];
  for (let i = start; i < words.length && run.length < 3 && meaningful(words[i]); i++) run.push(words[i]);
  return run.join(" ");
}

/** "uber eats" → "Uber Eats" (short words stay as they are). */
export function titleCase(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * A movement's name in a list: for a transfer, who it is with
 * ("TRF IMED P/ JOAO SILVA" → "Joao Silva"); otherwise the shop, without the
 * bank's "DD" (direct debit) marker.
 */
export function rowTitle(desc: string | null): string {
  if (isTransfer(desc)) {
    const k = transferKeyword(desc);
    if (k) return titleCase(k);
  }
  const m = normalizeMerchant(desc).replace(/^s?dd\s+/, "");
  return m ? titleCase(m) : (desc ?? "").trim();
}

const newestFirst =<T extends TriageTx>(a: T, b: T) => (a.booking_date < b.booking_date ? 1 : a.booking_date > b.booking_date ? -1 : 0);

/** The most common value (ties: the first one seen). */
function mostCommon(values: (string | null)[]): string | null {
  const count = new Map<string, number>();
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    const n = (count.get(v) ?? 0) + 1;
    count.set(v, n);
    if (best == null || n > (count.get(best) ?? 0)) best = v;
  }
  return best;
}

/**
 * Movements without a category, grouped so one choice files them all: by the
 * rule keyword of the description (then the merchant, then "Outros");
 * transfers by whom they are with and the direction (money from Joana is not
 * money to Joana). Groups of 2 or more first (biggest first), then singles.
 */
export function groupUncategorized<T extends TriageTx>(rows: T[], suggest?: (t: T) => string | null): TriageGroup<T>[] {
  const groups = new Map<string, TriageGroup<T>>();
  for (const t of rows) {
    const transfer = isTransfer(t.description_raw);
    const incoming = t.amount_cents > 0;
    const merchant = normalizeMerchant(t.description_raw);
    let keyword: string;
    let key: string;
    if (transfer) {
      keyword = transferKeyword(t.description_raw) || suggestRuleKeyword(t.description_raw);
      key = `t:${incoming ? "in" : "out"}:${keyword || merchant || "outros"}`;
    } else {
      keyword = suggestRuleKeyword(t.description_raw);
      key = keyword ? `k:${keyword}` : merchant ? `m:${merchant}` : "outros";
    }
    let g = groups.get(key);
    if (!g) {
      const name = keyword || merchant;
      g = {
        key,
        keyword: isUsableKeyword(keyword) ? keyword : "",
        label: name ? titleCase(name) : "Outros",
        rows: [],
        totalCents: 0,
        netCents: 0,
        transfer,
        incoming,
        suggestion: null,
      };
      groups.set(key, g);
    }
    g.rows.push(t);
    g.totalCents += Math.abs(t.amount_cents);
    g.netCents += t.amount_cents;
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.rows.sort(newestFirst);
    g.incoming = g.netCents > 0;
    if (suggest) g.suggestion = mostCommon(g.rows.map(suggest));
  }
  const byTotal = (a: TriageGroup<T>, b: TriageGroup<T>) => b.totalCents - a.totalCents || a.label.localeCompare(b.label, "pt");
  return [...out.filter((g) => g.rows.length >= 2).sort(byTotal), ...out.filter((g) => g.rows.length < 2).sort(byTotal)];
}

export interface CategoryRows<T extends TriageTx = TriageTx> {
  categoryId: string;
  rows: T[];
  totalCents: number;
  netCents: number;
}

/** Movements grouped by their (resolved) category, biggest first ("Por validar"). */
export function groupByCategory<T extends TriageTx & { category_id: string | null }>(
  rows: T[],
  resolve: (id: string | null) => string | null = (id) => id,
): CategoryRows<T>[] {
  const out = new Map<string, CategoryRows<T>>();
  for (const t of rows) {
    const id = resolve(t.category_id) ?? t.category_id;
    if (!id) continue;
    const g = out.get(id) ?? { categoryId: id, rows: [], totalCents: 0, netCents: 0 };
    g.rows.push(t);
    g.totalCents += Math.abs(t.amount_cents);
    g.netCents += t.amount_cents;
    out.set(id, g);
  }
  const list = [...out.values()];
  for (const g of list) g.rows.sort(newestFirst);
  return list.sort((a, b) => b.totalCents - a.totalCents);
}

/** Movements by day, newest day first (rows keep their order within a day). */
export function groupByDay<T extends TriageTx>(rows: T[]): [string, T[]][] {
  const byDay = new Map<string, T[]>();
  for (const t of rows) {
    const d = t.booking_date.slice(0, 10);
    const list = byDay.get(d) ?? [];
    list.push(t);
    byDay.set(d, list);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
}

/** Search: every word typed is in the description (no accents, any case). */
export function matchesSearch(desc: string | null | undefined, q: string): boolean {
  const words = plain(q).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const p = ` ${plain(desc)} `;
  return words.every((w) => p.includes(w));
}

export const VISTAS = ["categorizar", "validar", "todos", "entradas", "fixas", "dia", "trabalho", "voces", "poupanca", "pontuais"] as const;
export type Vista = (typeof VISTAS)[number];

export function parseVista(v: string | null | undefined): Vista | null {
  return (VISTAS as readonly string[]).includes(v ?? "") ? (v as Vista) : null;
}

/**
 * The view to open on: a filter in the link (category, income line, search)
 * shows the list; otherwise what still needs doing, else every movement.
 */
export function defaultVista(toCategorize: number, toValidate: number, hasFilter: boolean): Vista {
  if (hasFilter) return "todos";
  if (toCategorize > 0) return "categorizar";
  if (toValidate > 0) return "validar";
  return "todos";
}

/** The quick choices for a transfer: each of you, then savings. */
export function transferTargets(
  categories: SuggestCategoryRow[],
  members: SuggestMember[],
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const add = (c: SuggestCategoryRow | null) => {
    if (c && !out.some((x) => x.id === c.id)) out.push({ id: c.id, label: c.name });
  };
  if (members.length > 0) for (const m of members) add(memberCategory(m.id, members, categories));
  else for (const c of categories.filter((c) => !c.archived && c.grp === "mesada" && c.system_role === "mesada")) add(c);
  add(slotCategory("poupanca", categories));
  return out;
}
