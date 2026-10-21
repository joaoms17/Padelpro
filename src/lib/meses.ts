// The Meses screen's small pure helpers: how each income came in and how it
// compares with what was expected, the month chips, the account balance at
// both ends of a month, and the rows of the Comparar table. The totals
// themselves always come from the month engine (lib/month.ts).
import { plain } from "@shared/suggest";
import { isDueInMonth, looselyFits, maxPartFor } from "./forecast";
import { daysLabel, formatEuros, monthName, monthShort } from "./format";
import {
  incomeKind,
  INCOME_KEYS,
  lineLabel,
  makeClassifier,
  type Averages,
  type EngineCtx,
  type EngineIncome,
  type EngineTx,
  type IncomeKey,
  type Line,
  type MonthBreakdown,
} from "./month";

/** The income line each kind of expected income lands on. */
const KIND_LINE: Record<string, IncomeKey> = {
  salario: "ordenado",
  representacao: "representacao",
  renda: "renda",
  outra: "outras",
};

export interface ExpectedLine {
  key: IncomeKey;
  /** Everything due in the month for this line. */
  cents: number;
  /** The earliest usual day. */
  day: number;
  incomes: EngineIncome[];
}

/**
 * The first month each income was seen coming in (income id → YYYY-MM): a
 * credit with its keyword and about its amount or, without a keyword, a
 * credit on its kind's line (a categorized rent). Never seen: not in the map.
 */
export function incomeFirstSeen(
  incomes: EngineIncome[],
  txs: Pick<EngineTx, "id" | "booking_date" | "amount_cents" | "category_id" | "category_source" | "description_raw" | "source">[],
  ctx: Pick<EngineCtx, "categories" | "members" | "incomes">,
): Map<string, string> {
  const classify = makeClassifier(ctx);
  const credits = txs
    .filter((t) => t.amount_cents > 0 && t.source !== "applepay")
    .sort((a, b) => a.booking_date.localeCompare(b.booking_date))
    .map((t) => ({ t, k: classify(t) }));
  const out = new Map<string, string>();
  for (const i of incomes) {
    const line = KIND_LINE[incomeKind(i)] ?? "outras";
    const part = i.amount_cents / Math.max(1, i.parts);
    const max = maxPartFor(i, incomes);
    const first = credits.find(({ t, k }) =>
      i.match_text?.trim()
        ? looselyFits(t, i.match_text, part, max)
        : line !== "outras" && k.area === "entrada" && k.key === line,
    );
    if (first) out.set(i.id, first.t.booking_date.slice(0, 7));
  }
  return out;
}

/**
 * Did the income already exist in a month? Yes from the month it was set up,
 * and before that only once it had been seen coming in: an income added now
 * never "faltou" in the months before it.
 */
export function existedIn(i: Pick<EngineIncome, "id" | "created_at">, month: string, firstSeen: Map<string, string>): boolean {
  const created = i.created_at?.slice(0, 7);
  if (!created || month >= created) return true;
  const seen = firstSeen.get(i.id);
  return !!seen && seen <= month;
}

/**
 * What was expected on each income line in a month (from the incomes set up,
 * leaving out those that did not exist yet — see `existedIn`).
 */
export function expectedByLine(incomes: EngineIncome[], month: string, firstSeen: Map<string, string> = new Map()): Map<IncomeKey, ExpectedLine> {
  const out = new Map<IncomeKey, ExpectedLine>();
  for (const i of incomes) {
    if (!isDueInMonth(i, month) || !existedIn(i, month, firstSeen)) continue;
    const key = KIND_LINE[incomeKind(i)] ?? "outras";
    const cur = out.get(key) ?? { key, cents: 0, day: 31, incomes: [] };
    cur.cents += i.amount_cents;
    cur.day = Math.min(cur.day, i.day);
    cur.incomes.push(i);
    out.set(key, cur);
  }
  return out;
}

export type IncomeTagTone = "ok" | "warn" | "info";
export interface IncomeTag {
  tone: IncomeTagTone;
  text: string;
}

/** Arrived vs expected: "✓ como esperado", "inclui meses em atraso", "faltam X €". */
export function incomeTag(key: IncomeKey, cents: number, expected: number): IncomeTag | null {
  if (key === "extra") return { tone: "info", text: "pontual" };
  if (key === "sem") return { tone: "warn", text: "por categorizar" };
  if (!(expected > 0)) return null;
  const ratio = cents / expected;
  if (ratio > 1.5) return { tone: "info", text: "inclui meses em atraso" };
  if (ratio >= 0.95) return { tone: "ok", text: "✓ como esperado" };
  return { tone: "warn", text: `faltam ${formatEuros(expected - cents)}` };
}

/** "1 transferência · dia 23" / "2 transferências · dias 11 e 12". */
export function howItCame(line: Pick<Line, "key" | "count" | "days">): string {
  if (line.key === "extra") return "veio com o ordenado";
  const n = line.count;
  const what = `${n} ${n === 1 ? "transferência" : "transferências"}`;
  const days = daysLabel(line.days);
  return days ? `${what} · ${days}` : what;
}

export interface MissingIncome {
  key: IncomeKey;
  label: string;
  cents: number;
  day: number;
}

/**
 * Expected incomes that did not arrive at all (their line is empty). Never
 * added to the totals: only a warning under "O que entrou".
 */
export function missingIncomes(entradas: Line[], incomes: EngineIncome[], month: string, firstSeen: Map<string, string> = new Map()): MissingIncome[] {
  const out: MissingIncome[] = [];
  for (const e of expectedByLine(incomes, month, firstSeen).values()) {
    const got = entradas.find((l) => l.key === e.key)?.cents ?? 0;
    if (got > 0) continue;
    // "Outras entradas" may be several things: name each one.
    if (e.key === "outras") {
      for (const i of e.incomes) out.push({ key: e.key, label: i.label, cents: i.amount_cents, day: i.day });
    } else {
      out.push({ key: e.key, label: lineLabel(e.key, month), cents: e.cents, day: e.day });
    }
  }
  return out.sort((a, b) => INCOME_KEYS.indexOf(a.key) - INCOME_KEYS.indexOf(b.key) || a.day - b.day);
}

/** The rented house on its own: rent in, its mortgage out. */
export function casaArrendada(b: Pick<MonthBreakdown, "entradas" | "categorias">): { renda: number; prestacao: number; saldo: number } | null {
  const renda = b.entradas.find((l) => l.key === "renda")?.cents ?? 0;
  const prestacao = b.categorias
    .filter((c) => c.area === "fixa" && plain(c.name).includes("arrendada"))
    .reduce((a, c) => a + c.cents, 0);
  if (!(renda > 0) || !(prestacao > 0)) return null;
  return { renda, prestacao, saldo: renda - prestacao };
}

export interface MonthChip {
  month: string;
  label: string;
}

/** One chip per month (a partial first month is left out); the current one "até hoje". */
export function monthChips(months: string[], real: Map<string, Pick<MonthBreakdown, "status">>, current: string): MonthChip[] {
  return months
    .filter((m) => real.get(m)?.status !== "parcial")
    .map((m) => ({ month: m, label: m === current ? `${monthShort(m)} (até hoje)` : monthShort(m) }));
}

/** "1 set" / "30 set". */
export function dayShort(month: string, which: "first" | "last"): string {
  const [y, m] = month.split("-").map(Number);
  const d = which === "first" ? 1 : new Date(y, m, 0).getDate();
  return `${d} ${monthName(month).slice(0, 3)}`;
}

/** The account balance at the start (end of the month before) and end of a month. */
export function balanceEnds(endBalance: Map<string, number> | null, months: string[], month: string): { start: number | null; end: number } | null {
  const end = endBalance?.get(month);
  if (end == null) return null;
  const i = months.indexOf(month);
  const start = i > 0 ? (endBalance!.get(months[i - 1]) ?? null) : null;
  return { start, end };
}

/** Under the plan: how much of the mesada was taken, and what went beyond it. */
export function mesadaStatus(mesada: number, net: number): { dentro: number; alem: number; completa: boolean } {
  const taken = Math.max(0, net);
  return { dentro: Math.min(taken, mesada), alem: Math.max(0, taken - mesada), completa: mesada > 0 && taken >= mesada };
}

/** "Para o João" / "Para a Joana". */
export function paraLabel(name: string): string {
  return `Para ${/a$/i.test(plain(name)) ? "a" : "o"} ${name}`;
}

/** Within this, everything Joana received on Duet reached the account. */
const JOANA_TOLERANCE = 100;

export interface JoanaGap {
  /** Received on Duet but not in the account (never negative). */
  gap: number;
  /** The part of it marked as not owed ("Não é dívida"). */
  waived: number;
  /** Still to reach the account (0 within 1 €). */
  missing: number;
}

/**
 * From November Joana puts in the account everything she receives on Duet:
 * what Duet has and the account doesn't is still to arrive, unless a month's
 * difference was marked as not owed (`waived`, see saveJoanaWaiver).
 */
export function joanaGap(duet: number, bank: number, waived = 0): JoanaGap {
  const gap = Math.max(0, duet - bank);
  const w = Math.min(Math.max(0, waived), gap);
  const rest = gap - w;
  return { gap, waived: w, missing: rest <= JOANA_TOLERANCE ? 0 : rest };
}

// ── Comparar ────────────────────────────────────────────────────────────────

export interface CompareRow {
  key: string;
  label: string;
  /** One value per month (same order as the months). */
  values: number[];
  /** null: no average for this row. */
  avg: number | null;
  /** Shown as "entrou / saiu" (the pontuais). */
  pair?: { inn: number; out: number }[];
  kind?: "total" | "sub" | "result";
  /** Rows that open into per-category ones. */
  children?: CompareRow[];
}

const lineCents = (b: MonthBreakdown, k: IncomeKey) => b.entradas.find((l) => l.key === k)?.cents ?? 0;

function categoryRows(sem: MonthBreakdown[], averages: Averages, area: "fixa" | "dia"): CompareRow[] {
  const ids = new Map<string, string>();
  for (const b of sem) for (const c of b.categorias) if (c.area === area) ids.set(c.categoryId, c.name);
  for (const [id, a] of averages.categorias) if (a.area === area && !ids.has(id)) ids.set(id, a.name);
  return [...ids.entries()]
    .map(([id, name]) => ({
      key: `cat:${id}`,
      label: name,
      values: sem.map((b) => b.categorias.find((c) => c.categoryId === id)?.cents ?? 0),
      avg: averages.categorias.get(id)?.mean ?? 0,
      kind: "sub" as const,
    }))
    .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));
}

/**
 * The Comparar table: each month sem pontuais (`sem`) side by side with the
 * reference averages, plus the pontuais of each month from the real
 * breakdowns (`real`, same order). With `duet`, a row of what Joana received
 * on Duet each month (not part of "Entrou"), averaged as the plan does.
 */
export function compareRows(
  sem: MonthBreakdown[],
  real: MonthBreakdown[],
  averages: Averages,
  members: { id: string; display_name: string }[],
  duet?: { byMonth: Record<string, number>; average: number | null } | null,
): CompareRow[] {
  const rows: CompareRow[] = [
    { key: "entrou", label: "Entrou", values: sem.map((b) => b.entrou), avg: INCOME_KEYS.reduce((a, k) => a + averages.entradas[k], 0), kind: "total" },
    { key: "ordenado", label: "Ordenado", values: sem.map((b) => lineCents(b, "ordenado")), avg: averages.entradas.ordenado, kind: "sub" },
    { key: "representacao", label: "Representação", values: sem.map((b) => lineCents(b, "representacao")), avg: averages.entradas.representacao, kind: "sub" },
    { key: "renda", label: "Renda", values: sem.map((b) => lineCents(b, "renda")), avg: averages.entradas.renda, kind: "sub" },
    { key: "joana", label: "Joana", values: sem.map((b) => lineCents(b, "joana")), avg: averages.entradas.joana, kind: "sub" },
  ];
  if (duet) {
    rows.push({ key: "joana-duet", label: "Joana na Duet", values: sem.map((b) => duet.byMonth[b.month] ?? 0), avg: duet.average, kind: "sub" });
  }
  const outras = sem.map((b) => lineCents(b, "outras") + lineCents(b, "sem") + lineCents(b, "extra"));
  if (outras.some((x) => x !== 0)) {
    rows.push({ key: "outras", label: "Outras entradas", values: outras, avg: averages.entradas.outras + averages.entradas.sem + averages.entradas.extra, kind: "sub" });
  }
  rows.push(
    { key: "fixas", label: "Contas fixas", values: sem.map((b) => b.fixas), avg: averages.fixas, kind: "total", children: categoryRows(sem, averages, "fixa") },
    { key: "dia", label: "Dia a dia", values: sem.map((b) => b.dia), avg: averages.dia, kind: "total", children: categoryRows(sem, averages, "dia") },
    { key: "trabalho", label: "Trabalho da Joana", values: sem.map((b) => b.trabalho), avg: averages.trabalho, kind: "total" },
  );
  for (const m of members) {
    rows.push({
      key: `pessoa:${m.id}`,
      label: paraLabel(m.display_name),
      values: sem.map((b) => b.pessoas.find((p) => p.memberId === m.id)?.net ?? 0),
      avg: averages.pessoas[m.id] ?? 0,
      kind: "total",
    });
  }
  const semNome = sem.map((b) => b.pessoas.filter((p) => !p.memberId).reduce((a, p) => a + p.net, 0));
  if (semNome.some((x) => x !== 0)) {
    const used = sem.filter((b) => averages.months.includes(b.month));
    const avg = used.length ? Math.round(used.reduce((a, b) => a + b.pessoas.filter((p) => !p.memberId).reduce((x, p) => x + p.net, 0), 0) / used.length) : 0;
    rows.push({ key: "pessoa:?", label: "Para vocês (sem nome)", values: semNome, avg, kind: "total" });
  }
  rows.push(
    { key: "sem", label: "Sem categoria", values: sem.map((b) => b.semSaiu), avg: averages.semSaiu, kind: "total" },
    { key: "sobrou", label: "Sobrou", values: sem.map((b) => b.sobrou), avg: averages.sobrou, kind: "result" },
    {
      key: "pontuais",
      label: "Pontuais (entrou/saiu)",
      values: real.map((b) => b.pontualIn - b.pontualOut),
      avg: null,
      pair: real.map((b) => ({ inn: b.pontualIn, out: b.pontualOut })),
      kind: "sub",
    },
  );
  return rows;
}

/** A compact amount for the table: "1 234" / "−85" (euros, no symbol). */
export function compactEuros(cents: number): string {
  return formatEuros(cents).replace(/\s?€/, "").replace("-", "−").trim();
}
