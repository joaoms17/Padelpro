// End-of-month forecast: what is still coming in (expected incomes, Joana's
// events) and going out, from today's balance. Pure and testable.
import {
  isUsableKeyword,
  normalizeKeyword,
  normalizeMerchant,
  suggestRuleKeyword,
} from "@shared/categorize";
import { daysInMonth, paceProjection } from "./budget";

export interface ExpectedIncome {
  id: string;
  household_id: string;
  label: string;
  /** Total in a month it is due (e.g. 2 × 500 € = 100000). */
  amount_cents: number;
  /** How many transfers make it up. */
  parts: number;
  day: number;
  every_months: number;
  /** First day of a month in which it is due (YYYY-MM-01). */
  anchor_month: string;
  /** Keyword in the bank description, as in the rules. */
  match_text: string | null;
  active: boolean;
}

export interface Credit {
  id: string;
  booking_date: string;
  amount_cents: number;
  description_raw: string | null;
}

/** Whole months from `a` to `b` (both YYYY-MM…). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.slice(0, 7).split("-").map(Number);
  const [yb, mb] = b.slice(0, 7).split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function addMonth(month: string, n: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isDueInMonth(inc: Pick<ExpectedIncome, "active" | "anchor_month" | "every_months">, month: string): boolean {
  if (!inc.active) return false;
  const every = Math.max(1, inc.every_months);
  const d = monthDiff(inc.anchor_month, month);
  return ((d % every) + every) % every === 0;
}

/** The first month from `month` on in which the income is due. */
export function nextDueMonth(inc: Pick<ExpectedIncome, "active" | "anchor_month" | "every_months">, month: string): string {
  for (let i = 0; i < 12; i++) {
    const m = addMonth(month, i);
    if (isDueInMonth({ ...inc, active: true }, m)) return m;
  }
  return month;
}

export interface IncomeStatus {
  income: ExpectedIncome;
  receivedCents: number;
  pendingCents: number;
  /** False when it has no keyword: then it counts as arrived after its day. */
  detectable: boolean;
}

/** A movement counts towards a part if it has the keyword and a close amount. */
function fitsPart(c: Credit, keyword: string, partCents: number): boolean {
  return (
    c.amount_cents >= partCents * 0.5 &&
    c.amount_cents <= partCents * 1.5 &&
    normalizeMerchant(c.description_raw).includes(keyword)
  );
}

/** How many days a movement is from the income's usual day of the month. */
const LARGE_WINDOW_DAYS = 7;
const daysFrom = (c: Credit, day: number) => Math.abs(Number(c.booking_date.slice(8, 10)) - day);

/**
 * A bigger movement with the keyword near the income's day also counts: the
 * salary paid together with the subsídio de Natal or de férias (~2×) is
 * still the salary. Far from the day it is something else (e.g. the salary
 * is not the 500 € representation expenses paid on the 10th).
 */
function fitsLarge(c: Credit, keyword: string, partCents: number, day: number): boolean {
  return (
    c.amount_cents > partCents * 1.5 &&
    daysFrom(c, day) <= LARGE_WINDOW_DAYS &&
    normalizeMerchant(c.description_raw).includes(keyword)
  );
}

/** Credits that would count for an income with this keyword, part size and day (newest first). */
export function matchingCredits(matchText: string, partCents: number, day: number, credits: Credit[]): Credit[] {
  const keyword = normalizeKeyword(matchText);
  if (!keyword || !(partCents > 0)) return [];
  return credits
    .filter((c) => fitsPart(c, keyword, partCents) || fitsLarge(c, keyword, partCents, day))
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date));
}

/**
 * For each income due in `month`: what already arrived (this month's credits)
 * and what is still to come. Each movement counts for one income only:
 * first movements of about the expected size, then — for what is still
 * missing — a bigger one with the keyword near the income's day.
 */
export function incomeStatus(
  incomes: ExpectedIncome[],
  monthCredits: Credit[],
  month: string,
  today: string,
): IncomeStatus[] {
  const due = incomes
    .filter((i) => isDueInMonth(i, month))
    .sort((a, b) => b.amount_cents / b.parts - a.amount_cents / a.parts);
  const credits = [...monthCredits]
    .filter((c) => c.amount_cents > 0 && c.booking_date.slice(0, 7) === month)
    .sort((a, b) => a.booking_date.localeCompare(b.booking_date));
  const used = new Set<string>();
  const todayDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : today.slice(0, 7) > month ? 99 : 0;

  const state = due.map((income) => ({
    income,
    keyword: normalizeKeyword(income.match_text ?? ""),
    part: income.amount_cents / Math.max(1, income.parts),
    received: 0,
    n: 0,
  }));
  const take = (st: (typeof state)[number], fits: (c: Credit) => boolean) => {
    for (const c of credits) {
      if (st.n >= Math.max(1, st.income.parts) || st.received >= st.income.amount_cents) return;
      if (used.has(c.id) || !fits(c)) continue;
      used.add(c.id);
      st.received += c.amount_cents;
      st.n++;
    }
  };
  for (const st of state) if (st.keyword) take(st, (c) => fitsPart(c, st.keyword, st.part));
  for (const st of state) if (st.keyword) take(st, (c) => fitsLarge(c, st.keyword, st.part, st.income.day));

  const out = state.map(({ income, keyword, received }): IncomeStatus => {
    if (!keyword) {
      const arrived = todayDay > income.day;
      return { income, receivedCents: arrived ? income.amount_cents : 0, pendingCents: arrived ? 0 : income.amount_cents, detectable: false };
    }
    return { income, receivedCents: received, pendingCents: Math.max(0, income.amount_cents - received), detectable: true };
  });
  // Back to the order the household listed them in.
  return out.sort((a, b) => incomes.indexOf(a.income) - incomes.indexOf(b.income));
}

export interface IncomeSuggestion {
  label: string;
  match_text: string;
  amount_cents: number;
  parts: number;
  day: number;
  every_months: number;
  anchor_month: string;
  /** Months it was seen in. */
  months: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const mode = (xs: number[]) => {
  const count = new Map<number, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};
const titleCase = (s: string) => s.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));

/**
 * Regular incomes found in recent credits (same keyword, similar amount, in
 * at least two months, at a steady rhythm) that are not set up yet — e.g. the
 * salary on the 23rd, or 2 × 500 € every other month.
 */
export function suggestIncomes(
  credits: Credit[],
  existing: Pick<ExpectedIncome, "match_text" | "amount_cents" | "parts">[],
  today: string,
): IncomeSuggestion[] {
  const thisMonth = today.slice(0, 7);
  const byKey = new Map<string, Credit[]>();
  for (const c of credits) {
    if (c.amount_cents < 5000 || c.booking_date.slice(0, 7) > thisMonth) continue;
    const key = suggestRuleKeyword(c.description_raw);
    if (!key || !isUsableKeyword(key)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }

  const out: IncomeSuggestion[] = [];
  for (const [key, list] of byKey) {
    // Split by amount: a salary and 500 € transfers from the same payer differ.
    const sorted = [...list].sort((a, b) => a.amount_cents - b.amount_cents);
    const clusters: Credit[][] = [];
    for (const c of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && c.amount_cents <= last[0].amount_cents * 1.35) last.push(c);
      else clusters.push([c]);
    }
    for (const cl of clusters) {
      const byMonth = new Map<string, Credit[]>();
      for (const c of cl) {
        const m = c.booking_date.slice(0, 7);
        byMonth.set(m, [...(byMonth.get(m) ?? []), c]);
      }
      const months = [...byMonth.keys()].sort();
      if (months.length < 2) continue;
      const gaps = months.slice(1).map((m, i) => monthDiff(months[i], m));
      const every = mode(gaps);
      if (every > 3) continue;
      const last = months[months.length - 1];
      if (monthDiff(last, thisMonth) > every) continue; // stopped coming
      const parts = Math.max(1, median([...byMonth.values()].map((v) => v.length)));
      const part = median(cl.map((c) => c.amount_cents));
      const firstDays = [...byMonth.values()].map((v) => Math.min(...v.map((c) => Number(c.booking_date.slice(8, 10)))));
      const covered = existing.some(
        (e) =>
          normalizeKeyword(e.match_text ?? "") === key &&
          Math.abs(e.amount_cents / Math.max(1, e.parts) - part) <= part * 0.35,
      );
      if (covered) continue;
      out.push({
        label: titleCase(key),
        match_text: key,
        amount_cents: Math.round(part * parts),
        parts,
        day: median(firstDays),
        every_months: every,
        anchor_month: `${last}-01`,
        months: months.length,
      });
    }
  }
  return out.sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 6);
}

export interface ForecastLine {
  key: string;
  label: string;
  cents: number;
  detail?: string;
}

export interface Forecast {
  balanceCents: number;
  incoming: ForecastLine[];
  outgoing: ForecastLine[];
  endCents: number;
}

/** Variable spending still to come this month, at the pace so far. */
export function variaveisRestantes(gastoCents: number, month: string, today: string): number {
  const dim = daysInMonth(month);
  const sameMonth = today.slice(0, 7) === month;
  const day = sameMonth ? Number(today.slice(8, 10)) : dim;
  return Math.max(0, paceProjection(gastoCents, day, dim) - gastoCents);
}

/** Balance today + what still comes in − what still goes out = end of month. */
export function buildForecast(input: {
  balanceCents: number;
  incoming: ForecastLine[];
  fixasPorSairCents: number;
  mesadasPorSairCents: number;
  variaveisGastoCents: number;
  month: string;
  today: string;
}): Forecast {
  const incoming = input.incoming.filter((l) => l.cents > 0);
  const outgoing: ForecastLine[] = [
    { key: "fixas", label: "Fixas por pagar", cents: Math.max(0, input.fixasPorSairCents) },
    { key: "mesadas", label: "Mesadas por sair", cents: Math.max(0, input.mesadasPorSairCents) },
    {
      key: "variaveis",
      label: "Variáveis até ao fim do mês",
      cents: variaveisRestantes(input.variaveisGastoCents, input.month, input.today),
      detail: "ao ritmo de gastos deste mês",
    },
  ].filter((l) => l.cents > 0);
  const sum = (ls: ForecastLine[]) => ls.reduce((a, l) => a + l.cents, 0);
  return {
    balanceCents: input.balanceCents,
    incoming,
    outgoing,
    endCents: input.balanceCents + sum(incoming) - sum(outgoing),
  };
}
