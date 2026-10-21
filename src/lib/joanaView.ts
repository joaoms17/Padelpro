// Meses › Joana: her history on Duet month by month — what she marked as
// received (by payment date), the numbers the plan counts on, per project,
// what is already booked, and what reached the house account. Pure and
// testable; the month totals in the account come from the month engine.
import { makeNameFinder, plain } from "@shared/suggest";
import { addMonth } from "./forecast";
import { monthName } from "./format";
import { joanaGap, type JoanaGap } from "./meses";
import { JOANA_FROM, makeClassifier, type EngineCtx, type EngineTx, type MonthBreakdown } from "./month";
import { joanaHistory } from "./plan";
import { duetHistory, eventsByMonth } from "./planView";
import { rowTitle } from "./triage";

/** What Joana marked as received on Duet (see DuetReceipt). */
export interface Receipt {
  date: string;
  amount_cents: number;
  title: string;
  project: string | null;
}

/** A Duet event, as much as this view needs (see DuetEvent). */
export interface BookedEvent {
  date: string;
  value_cents: number;
  missing_cents: number;
}

export interface ReceiptMonth {
  month: string;
  cents: number;
  count: number;
  /** Newest first. */
  receipts: Receipt[];
}

const newestFirst = (a: Receipt, b: Receipt) => b.date.localeCompare(a.date);

/** The receipts of each month (YYYY-MM), each month's newest first. */
export function receiptsByMonth(receipts: Receipt[]): Map<string, ReceiptMonth> {
  const out = new Map<string, ReceiptMonth>();
  for (const r of receipts) {
    const m = r.date.slice(0, 7);
    const cur = out.get(m) ?? { month: m, cents: 0, count: 0, receipts: [] };
    cur.cents += r.amount_cents;
    cur.count++;
    cur.receipts.push(r);
    out.set(m, cur);
  }
  for (const g of out.values()) g.receipts.sort(newestFirst);
  return out;
}

export interface MonthValue {
  month: string;
  cents: number;
}

export interface JoanaStats {
  /** The complete months counted, oldest first: the last 12 before this one, from the first with money received. */
  months: string[];
  /** Her monthly average over those months: the plan's figure (joanaHistory). */
  average: number | null;
  median: number | null;
  /** The best and the weakest month (the oldest one, when tied). */
  best: MonthValue | null;
  weakest: MonthValue | null;
  total: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** The numbers the plan uses: over the complete months of the last `maxMonths` (never the current one). */
export function joanaStats(receipts: Receipt[], current: string, maxMonths = 12): JoanaStats {
  const hist = duetHistory(receipts, current, maxMonths);
  const months = Object.keys(hist).sort();
  const values = months.map((m) => hist[m]);
  const h = joanaHistory([], hist, current);
  let best: MonthValue | null = null;
  let weakest: MonthValue | null = null;
  for (const m of months) {
    if (!best || hist[m] > best.cents) best = { month: m, cents: hist[m] };
    if (!weakest || hist[m] < weakest.cents) weakest = { month: m, cents: hist[m] };
  }
  return { months, average: h.average, median: median(values), best, weakest, total: values.reduce((a, x) => a + x, 0) };
}

/** "de maio a setembro de 2026" / "de outubro de 2025 a setembro de 2026" / "setembro de 2026". */
export function rangeLabel(months: string[]): string {
  if (months.length === 0) return "";
  const a = months[0];
  const b = months[months.length - 1];
  if (a === b) return `${monthName(a)} de ${a.slice(0, 4)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `de ${monthName(a)} a ${monthName(b)} de ${b.slice(0, 4)}`;
  return `de ${monthName(a)} de ${a.slice(0, 4)} a ${monthName(b)} de ${b.slice(0, 4)}`;
}

/**
 * Received on Duet against what reached the account. From November she puts
 * in everything, so the difference is still to arrive unless marked as not
 * owed; before, it is not a debt (null).
 */
export function monthGap(month: string, duet: number, bank: number | null, waived = 0): JoanaGap | null {
  if (bank == null || month < JOANA_FROM) return null;
  return joanaGap(duet, bank, waived);
}

export interface JoanaMonthRow extends ReceiptMonth {
  /** 0–1 against the best month (the bar). */
  ratio: number;
  /** What reached the account (null: no bank data for the month). */
  bank: number | null;
  /** From November: what is still to arrive (waivers honoured); null before or without bank data. */
  gap: JoanaGap | null;
}

/**
 * The complete months (those of joanaStats), newest first. `bank`: what
 * reached the account in the months with whole bank data; `waivers`: the
 * "Não é dívida" per month.
 */
export function joanaMonthRows(
  receipts: Receipt[],
  current: string,
  bank: Record<string, number>,
  waivers: Record<string, number> = {},
  maxMonths = 12,
): JoanaMonthRow[] {
  const { months, best } = joanaStats(receipts, current, maxMonths);
  const by = receiptsByMonth(receipts);
  const top = best?.cents ?? 0;
  return [...months].reverse().map((m) => {
    const g = by.get(m) ?? { month: m, cents: 0, count: 0, receipts: [] };
    const b = m in bank ? bank[m] : null;
    return { ...g, ratio: top > 0 ? Math.max(0, g.cents) / top : 0, bank: b, gap: monthGap(m, g.cents, b, waivers[m] ?? 0) };
  });
}

export interface JoanaNow extends ReceiptMonth {
  /** Still to receive on Duet for this month's events. */
  toReceive: number;
  /** How many of this month's events still have something to receive. */
  pending: number;
  bank: number | null;
  gap: JoanaGap | null;
}

/** The month running: received so far, still to receive on Duet, and what reached the account. */
export function joanaNow(receipts: Receipt[], events: BookedEvent[], current: string, bank: number | null, waived = 0): JoanaNow {
  const g = receiptsByMonth(receipts.filter((r) => r.date.slice(0, 7) === current)).get(current) ?? { month: current, cents: 0, count: 0, receipts: [] };
  const open = events.filter((e) => e.date.slice(0, 7) === current && e.missing_cents > 0);
  return {
    ...g,
    toReceive: open.reduce((a, e) => a + e.missing_cents, 0),
    pending: open.length,
    bank,
    gap: monthGap(current, g.cents, bank, waived),
  };
}

export interface BookedMonth {
  month: string;
  /** The events' values (what is already booked). */
  cents: number;
  count: number;
}

/** The next `n` months after `current`: what is already booked on Duet (as the Plano counts it). */
export function bookedMonths(events: BookedEvent[], current: string, n = 6): BookedMonth[] {
  const sums = eventsByMonth(events);
  const out: BookedMonth[] = [];
  for (let i = 1; i <= n; i++) {
    const m = addMonth(current, i);
    out.push({ month: m, cents: sums[m] ?? 0, count: events.filter((e) => e.date.slice(0, 7) === m).length });
  }
  return out;
}

export const NO_PROJECT = "Sem projeto";

export interface ProjectTotal {
  project: string;
  cents: number;
  count: number;
  /** 0–1 of the total. */
  share: number;
}

/** What she received per project in `months` (biggest first). */
export function byProject(receipts: Receipt[], months: string[]): ProjectTotal[] {
  const set = new Set(months);
  const by = new Map<string, { cents: number; count: number }>();
  for (const r of receipts) {
    if (!set.has(r.date.slice(0, 7))) continue;
    const k = (r.project ?? "").trim() || NO_PROJECT;
    const cur = by.get(k) ?? { cents: 0, count: 0 };
    cur.cents += r.amount_cents;
    cur.count++;
    by.set(k, cur);
  }
  const total = [...by.values()].reduce((a, x) => a + x.cents, 0);
  return [...by.entries()]
    .map(([project, x]) => ({ project, ...x, share: total > 0 ? x.cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents || a.project.localeCompare(b.project));
}

/** A share as a whole percent ("62%"). */
export const pct = (share: number) => `${Math.round(share * 100)}%`;

export interface JoanaTransfer {
  id: string;
  date: string;
  cents: number;
  /** Who it came from ("Joana Carneiro Moraes"). */
  title: string;
}

export interface JoanaTransferMonth {
  month: string;
  cents: number;
  /** Newest first. */
  transfers: JoanaTransfer[];
}

type TxLite = Pick<EngineTx, "id" | "booking_date" | "amount_cents" | "description_raw">;

/** Her transfers into the account per month (the engine's "joana" line), newest month first. */
export function joanaTransfers(breakdowns: MonthBreakdown[], txs: TxLite[]): JoanaTransferMonth[] {
  const byId = new Map(txs.map((t) => [t.id, t]));
  return [...breakdowns]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((b) => {
      const line = b.entradas.find((l) => l.key === "joana");
      const transfers = (line?.txIds ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is TxLite => !!t)
        .map((t) => ({ id: t.id, date: t.booking_date, cents: t.amount_cents, title: rowTitle(t.description_raw) }))
        .sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id));
      return { month: b.month, cents: line?.cents ?? 0, transfers };
    });
}

/**
 * Money in without a category whose description names Joana, but that the
 * engine does not count as hers (e.g. it matched an expected income). It
 * should be none: worth a look when it is not.
 */
export function joanaUnclassified<T extends EngineTx>(txs: T[], ctx: Pick<EngineCtx, "categories" | "members" | "incomes">, from = ""): T[] {
  const joana = ctx.members.find((m) => plain(m.display_name) === "joana")?.id ?? null;
  if (!joana) return [];
  const byName = makeNameFinder(ctx.members);
  const classify = makeClassifier(ctx);
  return txs.filter((t) => {
    if (t.amount_cents <= 0 || t.category_id || t.source === "applepay" || t.booking_date < from) return false;
    if (byName(t.description_raw) !== joana) return false;
    const k = classify(t);
    return !(k.area === "entrada" && k.key === "joana");
  });
}
