// The month, as one set of accounts: what came in (and how), where it went
// (the house, each of you, savings) and what was left. Every screen reads
// its numbers from here, so they always agree. Pure and testable.
import { hasIncomeKeyword, incomeFor, isTransfer, kindOf, makeNameFinder, plain } from "../suggest.ts";
import { displayMerchant, normalizeMerchant } from "../categorize.ts";
import { isDueInMonth, type ExpectedIncome } from "./forecast.ts";
import type { Category, Member, TransactionSource } from "./types.ts";

/** First month Joana's events money goes to the house account. */
export const JOANA_FROM = "2026-11";

export interface EngineTx {
  id: string;
  booking_date: string;
  amount_cents: number;
  category_id: string | null;
  category_source?: string | null;
  description_raw: string | null;
  source: TransactionSource;
  pontual?: boolean | null;
  note?: string | null;
  merchant_clean?: string | null;
}

export type IncomeKind = "salario" | "representacao" | "renda" | "outra";
export type EngineIncome = ExpectedIncome & { kind?: IncomeKind | null };

export interface EngineCtx {
  /** Every category, archived ones too (a movement may still point at one). */
  categories: Pick<Category, "id" | "grp" | "name" | "system_role" | "archived" | "merged_into" | "sort" | "budget_cents">[];
  members: Pick<Member, "id" | "display_name">[];
  incomes: EngineIncome[];
  /** Today in Lisbon, YYYY-MM-DD. */
  today: string;
  /** First day with bank movements. */
  firstDataDate: string | null;
}

export type Area = "entrada" | "fixa" | "dia" | "trabalho" | "voces" | "poupanca" | "sem";
export type IncomeKey = "ordenado" | "extra" | "representacao" | "renda" | "joana" | "outras" | "sem";
export const INCOME_KEYS: IncomeKey[] = ["ordenado", "extra", "representacao", "renda", "joana", "outras", "sem"];

export interface Classified {
  area: Area;
  /** entrada: an IncomeKey · fixa/dia/trabalho: the category · voces: the member ("?" unknown) · poupanca: "para"/"de" · sem: "out". */
  key: string;
  categoryId: string | null;
  memberId: string | null;
}

/** Money is filed under the latest category it was merged into. */
export function makeResolver(categories: EngineCtx["categories"]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (id: string | null | undefined) => {
    let c = id ? byId.get(id) : undefined;
    for (let hops = 0; c?.archived && hops < 10; hops++) c = c.merged_into ? byId.get(c.merged_into) : undefined;
    return c && !c.archived ? c : null;
  };
}

const GROUP_AREA: Record<string, Area> = { fixa: "fixa", variavel: "dia", atividade: "trabalho" };
const ROLE_KEY: Record<string, IncomeKey> = { salario: "ordenado", representacao: "representacao", renda: "renda", eventos: "joana" };
const KIND_KEY: Record<string, IncomeKey> = { salario: "ordenado", representacao: "representacao", renda: "renda", outra: "outras" };

/** The kind of an income (as stored; guessed from its name when not set). */
export function incomeKind(i: Pick<EngineIncome, "kind" | "label">): IncomeKind {
  return kindOf(i);
}

/**
 * What a movement is. A category decides (following merges); without one, an
 * expected income's keyword, then a transfer naming one of you, then
 * "Sem categoria". A refund (money in, in a house category) lowers that
 * category; money out in an income category lowers that income.
 */
export function makeClassifier(ctx: Pick<EngineCtx, "categories" | "members" | "incomes">) {
  const resolve = makeResolver(ctx.categories);
  const byName = makeNameFinder(ctx.members);
  const joana = ctx.members.find((m) => plain(m.display_name) === "joana")?.id ?? null;
  const memberOfCategory = new Map<string, string>();
  for (const c of ctx.categories) {
    if (c.grp !== "mesada") continue;
    const words = plain(c.name).split(" ");
    const m = ctx.members.find((x) => plain(x.display_name).length >= 3 && words.includes(plain(x.display_name)));
    if (m) memberOfCategory.set(c.id, m.id);
  }
  const incomes = ctx.incomes.filter((i) => i.active);

  return (t: Pick<EngineTx, "amount_cents" | "category_id" | "description_raw"> & { category_source?: string | null }): Classified => {
    const credit = t.amount_cents > 0;
    const c = resolve(t.category_id);
    if (c) {
      const area = GROUP_AREA[c.grp];
      if (area) return { area, key: c.id, categoryId: c.id, memberId: null };
      if (c.grp === "mesada") {
        const m = memberOfCategory.get(c.id) ?? byName(t.description_raw);
        return { area: "voces", key: m ?? "?", categoryId: c.id, memberId: m };
      }
      if (c.grp === "interna") {
        // Old "Entre contas" rows naming one of you were money for that
        // person; a movement someone filed as Poupança by hand stays savings.
        const m = t.category_source === "manual" ? null : byName(t.description_raw);
        if (m) return { area: "voces", key: m, categoryId: c.id, memberId: m };
        return { area: "poupanca", key: credit ? "de" : "para", categoryId: c.id, memberId: null };
      }
      // An income category (money out there is a correction of that income).
      return { area: "entrada", key: ROLE_KEY[c.system_role ?? ""] ?? "outras", categoryId: c.id, memberId: null };
    }
    if (credit) {
      const inc = incomeFor(t.amount_cents, t.description_raw, incomes);
      if (inc) return { area: "entrada", key: KIND_KEY[kindOf(inc)] ?? "outras", categoryId: null, memberId: null };
      // An income's keyword with an unusual amount is still money in, never a person's.
      if (incomes.some((i) => hasIncomeKeyword(t.description_raw, i))) return { area: "entrada", key: "sem", categoryId: null, memberId: null };
      const who = byName(t.description_raw);
      if (who && who === joana) return { area: "entrada", key: "joana", categoryId: null, memberId: null };
      if (who && isTransfer(t.description_raw)) return { area: "voces", key: who, categoryId: null, memberId: who };
      return { area: "entrada", key: "sem", categoryId: null, memberId: null };
    }
    const who = isTransfer(t.description_raw) ? byName(t.description_raw) : null;
    if (who) return { area: "voces", key: who, categoryId: null, memberId: who };
    return { area: "sem", key: "out", categoryId: null, memberId: null };
  };
}

const DAY_MS = 86400000;
const dayNum = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS;

/**
 * Does a movement count in a month? Apple Pay notes only count while the bank
 * hasn't booked them yet: in the current month, up to 5 days old ("pendente").
 */
export function inScope(t: Pick<EngineTx, "booking_date" | "source">, month: string, today: string): boolean {
  if (t.booking_date.slice(0, 7) !== month) return false;
  if (t.source !== "applepay") return true;
  return month === today.slice(0, 7) && dayNum(today) - dayNum(t.booking_date) <= 5;
}

export type Method = "debito_direto" | "cartao" | "transferencia" | "mbway" | "levantamento" | "outro";
export const METHOD_LABELS: Record<Method, string> = {
  debito_direto: "Débitos diretos",
  cartao: "Cartão",
  transferencia: "Transferências",
  mbway: "MB Way",
  levantamento: "Levantamentos",
  outro: "Outro",
};

/** How money left, from the bank description. */
export function paymentMethod(desc: string | null | undefined): Method {
  const p = ` ${plain(desc)} `;
  if (/ (deb dir|debito direto|debito directo|dd|cobranca|sdd|prestacao|emprestimo) /.test(p)) return "debito_direto";
  if (/ (mb way|mbway) /.test(p)) return "mbway";
  if (/ (levantamento|lev|atm) /.test(p)) return "levantamento";
  if (/^ (trf|transf|transferencia|trf imed)\b/.test(p) || / (trf|transferencia|sepa) /.test(p)) return "transferencia";
  if (/ (compra|compras|cartao|pos|apple pay|contactless) /.test(p)) return "cartao";
  return "outro";
}

export interface Line {
  key: IncomeKey;
  label: string;
  cents: number;
  count: number;
  txIds: string[];
  /** Day of the month of each movement, for "como entrou". */
  days: number[];
}

export interface CategoryLine {
  categoryId: string;
  name: string;
  area: "fixa" | "dia" | "trabalho";
  /** What it cost: money out minus refunds. */
  cents: number;
  refundCents: number;
  count: number;
  txIds: string[];
}

export interface PersonLine {
  /** null: in "Para vocês" but no name on it. */
  memberId: string | null;
  name: string;
  levou: number;
  devolveu: number;
  net: number;
  txIds: string[];
}

export interface TxRef {
  id: string;
  date: string;
  desc: string;
  cents: number;
  categoryId: string | null;
  pontual: boolean;
}

export type MonthStatus = "parcial" | "a_decorrer" | "provisorio" | "completo";

export interface MonthBreakdown {
  month: string;
  status: MonthStatus;
  semPontuais: boolean;
  entrou: number;
  entradas: Line[];
  /** The expected salary this month (0 when none is set up or due). */
  expectedSalary: number;
  fixas: number;
  dia: number;
  trabalho: number;
  casa: number;
  categorias: CategoryLine[];
  voces: number;
  pessoas: PersonLine[];
  semSaiu: number;
  /** Movements with no category and no other way to tell (in and out). */
  semCount: number;
  semIds: string[];
  /** Filed by a suggestion or the AI, not confirmed yet. */
  porValidar: number;
  poupancaPara: number;
  poupancaDe: number;
  /** entrou − casa − voces − semSaiu (money moved to savings still "sobrou"). */
  sobrou: number;
  pontualIn: number;
  pontualOut: number;
  maiores: TxRef[];
  metodo: Record<Method, number>;
  /** Apple Pay notes counted while the bank hasn't booked them. */
  pendentes: number;
  txCount: number;
}

const LINE_LABEL: Record<IncomeKey, string> = {
  ordenado: "Ordenado do João",
  extra: "Extra (prémio, subsídio)",
  representacao: "Despesas de representação",
  renda: "Renda da casa arrendada",
  joana: "Joana",
  outras: "Outras entradas",
  sem: "Entradas sem categoria",
};

export function lineLabel(key: IncomeKey, month: string): string {
  if (key === "joana" && month < JOANA_FROM) return "Transferências da Joana";
  return LINE_LABEL[key];
}

/** The salary expected in a month (all salary incomes due then). */
export function expectedSalary(incomes: EngineIncome[], month: string): number {
  return incomes
    .filter((i) => incomeKind(i) === "salario" && isDueInMonth(i, month))
    .reduce((a, i) => a + i.amount_cents, 0);
}

export function monthStatus(month: string, ctx: Pick<EngineCtx, "today" | "firstDataDate">, semCount: number): MonthStatus {
  const first = ctx.firstDataDate;
  if (first && month === first.slice(0, 7) && Number(first.slice(8, 10)) > 3) return "parcial";
  if (month >= ctx.today.slice(0, 7)) return "a_decorrer";
  return semCount > 0 ? "provisorio" : "completo";
}

const SUGGESTED = new Set(["sugestao", "ai"]);

export function monthBreakdown(
  txs: EngineTx[],
  ctx: EngineCtx,
  month: string,
  opts: { semPontuais?: boolean } = {},
): MonthBreakdown {
  const semPontuais = !!opts.semPontuais;
  const classify = makeClassifier(ctx);
  const resolve = makeResolver(ctx.categories);
  const lines = new Map<IncomeKey, Line>(INCOME_KEYS.map((k) => [k, { key: k, label: lineLabel(k, month), cents: 0, count: 0, txIds: [], days: [] }]));
  const cats = new Map<string, CategoryLine>();
  const people = new Map<string, PersonLine>();
  const memberName = new Map(ctx.members.map((m) => [m.id, m.display_name]));
  const metodo: Record<Method, number> = { debito_direto: 0, cartao: 0, transferencia: 0, mbway: 0, levantamento: 0, outro: 0 };
  let semSaiu = 0;
  let semCount = 0;
  const semIds: string[] = [];
  let porValidar = 0;
  let poupancaPara = 0;
  let poupancaDe = 0;
  let pontualIn = 0;
  let pontualOut = 0;
  let pendentes = 0;
  let txCount = 0;
  const houseDebits: TxRef[] = [];

  let ordPontual = 0;
  for (const t of txs) {
    if (!inScope(t, month, ctx.today)) continue;
    const k = classify(t);
    const pontual = !!t.pontual;
    // The salary line is never dropped: its one-off part is split off below.
    const salary = k.area === "entrada" && k.key === "ordenado" && t.amount_cents > 0;
    if (pontual && semPontuais && !salary) continue;
    txCount++;
    if (t.source === "applepay") pendentes++;
    if (t.category_source && SUGGESTED.has(t.category_source) && t.category_id) porValidar++;
    const amount = t.amount_cents;
    if (pontual && salary) ordPontual += amount;
    else if (pontual) {
      if (amount > 0) pontualIn += amount;
      else pontualOut -= amount;
    }
    if (k.area !== "poupanca" && amount < 0) metodo[paymentMethod(t.description_raw)] -= amount;

    switch (k.area) {
      case "entrada": {
        const l = lines.get(k.key as IncomeKey)!;
        l.cents += amount;
        l.count++;
        l.txIds.push(t.id);
        l.days.push(Number(t.booking_date.slice(8, 10)));
        if (k.key === "sem") {
          semCount++;
          semIds.push(t.id);
        }
        break;
      }
      case "fixa":
      case "dia":
      case "trabalho": {
        const cat = resolve(k.categoryId);
        const cur = cats.get(k.key) ?? { categoryId: k.key, name: cat?.name ?? "—", area: k.area, cents: 0, refundCents: 0, count: 0, txIds: [] };
        cur.cents -= amount;
        if (amount > 0) cur.refundCents += amount;
        cur.count++;
        cur.txIds.push(t.id);
        cats.set(k.key, cur);
        if (amount < 0 && k.area !== "fixa") {
          houseDebits.push({ id: t.id, date: t.booking_date, desc: displayMerchant(t.description_raw) || (t.description_raw ?? ""), cents: -amount, categoryId: k.categoryId, pontual });
        }
        break;
      }
      case "voces": {
        const key = k.memberId ?? "?";
        const cur = people.get(key) ?? { memberId: k.memberId, name: k.memberId ? (memberName.get(k.memberId) ?? "?") : "Sem nome", levou: 0, devolveu: 0, net: 0, txIds: [] };
        if (amount < 0) cur.levou -= amount;
        else cur.devolveu += amount;
        cur.net = cur.levou - cur.devolveu;
        cur.txIds.push(t.id);
        people.set(key, cur);
        break;
      }
      case "poupanca":
        if (amount < 0) poupancaPara -= amount;
        else poupancaDe += amount;
        break;
      case "sem":
        semSaiu -= amount;
        semCount++;
        semIds.push(t.id);
        break;
    }
  }

  // The salary that came with a prémio or subsídio: the normal part is the
  // salary, the rest is a one-off extra. Without an expected salary, what was
  // marked pontual is the extra.
  const E = expectedSalary(ctx.incomes, month);
  const ord = lines.get("ordenado")!;
  let extra = 0;
  if (E > 0) {
    if (ord.cents > Math.round(E * 1.15)) extra = ord.cents - E;
  } else {
    extra = Math.max(0, ordPontual);
  }
  if (extra > 0) {
    ord.cents -= extra;
    if (!semPontuais) {
      const ex = lines.get("extra")!;
      ex.cents += extra;
      ex.count = 1;
      ex.txIds = [...ord.txIds];
      ex.days = [...ord.days];
      pontualIn += extra;
    }
  }

  const categorias = [...cats.values()].sort((a, b) => b.cents - a.cents);
  const sum = (area: CategoryLine["area"]) => categorias.filter((c) => c.area === area).reduce((a, c) => a + c.cents, 0);
  const fixas = sum("fixa");
  const dia = sum("dia");
  const trabalho = sum("trabalho");
  const casa = fixas + dia + trabalho;
  // Both of you always show (0 € too), in the members' order.
  for (const m of ctx.members) {
    if (!people.has(m.id)) people.set(m.id, { memberId: m.id, name: m.display_name, levou: 0, devolveu: 0, net: 0, txIds: [] });
  }
  const order = new Map(ctx.members.map((m, i) => [m.id, i]));
  const pessoas = [...people.values()].sort((a, b) => (order.get(a.memberId ?? "") ?? 99) - (order.get(b.memberId ?? "") ?? 99));
  const voces = pessoas.reduce((a, p) => a + p.net, 0);
  const entradas = [...lines.values()];
  const entrou = entradas.reduce((a, l) => a + l.cents, 0);

  return {
    month,
    status: monthStatus(month, ctx, semCount),
    semPontuais,
    entrou,
    entradas,
    expectedSalary: E,
    fixas,
    dia,
    trabalho,
    casa,
    categorias,
    voces,
    pessoas,
    semSaiu,
    semCount,
    semIds,
    porValidar,
    poupancaPara,
    poupancaDe,
    sobrou: entrou - casa - voces - semSaiu,
    pontualIn,
    pontualOut,
    maiores: houseDebits.sort((a, b) => b.cents - a.cents).slice(0, 10),
    metodo,
    pendentes,
    txCount,
  };
}

/**
 * Months worth comparing: ended and complete enough — at most 10 movements
 * without category and at most 5 % of the house costs (a big transfer to one
 * of you must not make a month look complete).
 */
export function eligible(b: MonthBreakdown): boolean {
  if (b.status === "parcial" || b.status === "a_decorrer") return false;
  return b.semCount <= 10 && b.semSaiu <= Math.max(0, b.casa + b.semSaiu) * 0.05;
}

/**
 * Transfers to one of you that look like the month's extra (prémio,
 * subsídio) passed on: at least half of it, not marked pontual yet. Marked
 * pontual, they stay out of the averages like the extra itself.
 */
export function pontualCandidates(txs: EngineTx[], ctx: EngineCtx, b: MonthBreakdown): TxRef[] {
  const extra = b.entradas.find((l) => l.key === "extra")?.cents ?? 0;
  if (extra <= 0) return [];
  const classify = makeClassifier(ctx);
  return txs
    .filter((t) => inScope(t, b.month, ctx.today) && t.amount_cents < 0 && !t.pontual && -t.amount_cents >= extra * 0.5)
    .filter((t) => classify(t).area === "voces")
    .map((t) => ({ id: t.id, date: t.booking_date, desc: displayMerchant(t.description_raw) || (t.description_raw ?? ""), cents: -t.amount_cents, categoryId: t.category_id, pontual: false }));
}

/**
 * Bank balance at the end of each month, walking back from today's balance.
 * Apple Pay notes and manual entries never moved the bank balance.
 */
export function monthEndBalances(txs: EngineTx[], balanceCents: number, months: string[]): Map<string, number> {
  const bank = txs.filter((t) => t.source === "banco" || t.source === "extrato");
  const out = new Map<string, number>();
  for (const m of months) {
    const after = bank.filter((t) => t.booking_date.slice(0, 7) > m).reduce((a, t) => a + t.amount_cents, 0);
    out.set(m, balanceCents - after);
  }
  return out;
}

/** Months from the first with data to the current one. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.slice(0, 7).split("-").map(Number);
  const [ly, lm] = last.slice(0, 7).split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface Averages {
  /** The months the averages come from. */
  months: string[];
  /** No month is complete yet: these come from months still missing categories. */
  provisorio: boolean;
  /** Per category id: cents in each month and the mean (sem pontuais). */
  categorias: Map<string, { name: string; area: CategoryLine["area"]; perMonth: Record<string, number>; mean: number }>;
  entradas: Record<IncomeKey, number>;
  casa: number;
  fixas: number;
  dia: number;
  trabalho: number;
  semSaiu: number;
  /** Per member id: what each one took (net). */
  pessoas: Record<string, number>;
  sobrou: number;
}

/**
 * Averages over the reference months (sem pontuais): the eligible ones, or,
 * while none is, every ended month that isn't partial (marked provisório).
 */
export function referenceAverages(breakdownsSemPontuais: MonthBreakdown[]): Averages {
  const ended = breakdownsSemPontuais.filter((b) => b.status === "provisorio" || b.status === "completo");
  const good = ended.filter(eligible);
  const use = good.length > 0 ? good : ended;
  const n = Math.max(1, use.length);
  const mean = (f: (b: MonthBreakdown) => number) => Math.round(use.reduce((a, b) => a + f(b), 0) / n);
  const categorias: Averages["categorias"] = new Map();
  for (const b of use) {
    for (const c of b.categorias) {
      const cur = categorias.get(c.categoryId) ?? { name: c.name, area: c.area, perMonth: {}, mean: 0 };
      cur.perMonth[b.month] = c.cents;
      categorias.set(c.categoryId, cur);
    }
  }
  for (const c of categorias.values()) c.mean = Math.round(Object.values(c.perMonth).reduce((a, x) => a + x, 0) / n);
  const entradas = Object.fromEntries(INCOME_KEYS.map((k) => [k, mean((b) => b.entradas.find((l) => l.key === k)?.cents ?? 0)])) as Record<IncomeKey, number>;
  const pessoas: Record<string, number> = {};
  for (const b of use) for (const p of b.pessoas) if (p.memberId) pessoas[p.memberId] = (pessoas[p.memberId] ?? 0) + p.net / n;
  for (const k of Object.keys(pessoas)) pessoas[k] = Math.round(pessoas[k]);
  return {
    months: use.map((b) => b.month),
    provisorio: good.length === 0 && use.length > 0,
    categorias,
    entradas,
    casa: mean((b) => b.casa),
    fixas: mean((b) => b.fixas),
    dia: mean((b) => b.dia),
    trabalho: mean((b) => b.trabalho),
    semSaiu: mean((b) => b.semSaiu),
    pessoas,
    sobrou: mean((b) => b.sobrou),
  };
}

export interface MerchantTotal {
  key: string;
  label: string;
  cents: number;
  count: number;
}

/** Where the money of some movements went, by shop (biggest first). */
export function topMerchants(txs: EngineTx[], ids: string[], n = 5): MerchantTotal[] {
  const want = new Set(ids);
  const out = new Map<string, MerchantTotal>();
  for (const t of txs) {
    if (!want.has(t.id)) continue;
    const key = normalizeMerchant(t.description_raw) || "?";
    const cur = out.get(key) ?? { key, label: displayMerchant(t.description_raw) || "Sem descrição", cents: 0, count: 0 };
    cur.cents -= t.amount_cents;
    cur.count++;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => b.cents - a.cents).slice(0, n);
}

/** Today's date in Lisbon (YYYY-MM-DD). */
export function todayLisbon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
