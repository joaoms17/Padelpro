// Expected incomes: when each one is due, what of it already arrived this
// month and what is still to come; regular incomes found in the bank. Pure
// and testable.
import {
  isUsableKeyword,
  normalizeKeyword,
  normalizeMerchant,
  suggestRuleKeyword,
} from "@shared/categorize";

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
  /** The movements counted for it. */
  creditIds: string[];
  pendingCents: number;
  /** False when it has no keyword: then it counts as arrived after its day. */
  detectable: boolean;
}

// A movement counts for an expected income when it has the keyword, lands
// near the income's day (payroll comes early before holidays, never weeks
// late) and is between half a part and 2.5 parts — the salary paid together
// with the subsídio de Natal/férias (~2×) is still the salary, while the
// previous month's late salary on the 1st, or a 5 000 € payroll, cannot be
// taken for 500 € expenses.
const DAYS_BEFORE = 10;
const DAYS_AFTER = 7;
const MIN_PART = 0.5;
const MAX_PART = 2.5;

/** Keyword and amount only, any day: a late or early transfer (catching up two months). */
export function looselyFits(c: Credit, matchText: string, partCents: number, maxPart = MAX_PART): boolean {
  const keyword = normalizeKeyword(matchText);
  return (
    !!keyword &&
    c.amount_cents >= partCents * MIN_PART &&
    c.amount_cents <= partCents * maxPart &&
    normalizeMerchant(c.description_raw).includes(keyword)
  );
}

/**
 * The biggest income for a keyword (the salary) takes any larger amount —
 * a prémio or subsídio paid with it can be 3-4×. Smaller ones from the same
 * payer (500 € expenses) stay capped, so they never take the salary.
 */
export function maxPartFor(income: ExpectedIncome, all: ExpectedIncome[]): number {
  const k = normalizeKeyword(income.match_text ?? "");
  const part = (i: ExpectedIncome) => i.amount_cents / Math.max(1, i.parts);
  const biggest = all
    .filter((i) => i.active && normalizeKeyword(i.match_text ?? "") === k)
    .every((i) => part(i) <= part(income));
  return biggest ? Infinity : MAX_PART;
}

function eligible(c: Credit, keyword: string, partCents: number, day: number, maxPart = MAX_PART): boolean {
  const d = Number(c.booking_date.slice(8, 10));
  return (
    d >= day - DAYS_BEFORE &&
    d <= day + DAYS_AFTER &&
    c.amount_cents >= partCents * MIN_PART &&
    c.amount_cents <= partCents * maxPart &&
    normalizeMerchant(c.description_raw).includes(keyword)
  );
}

/** Lower is better: close to the expected part and to the usual day. */
const fitScore = (c: Credit, partCents: number, day: number) =>
  Math.abs(c.amount_cents - partCents) / partCents + Math.abs(Number(c.booking_date.slice(8, 10)) - day) / 30;

/** Credits that would count for an income with this keyword, part size and day (newest first). */
export function matchingCredits(matchText: string, partCents: number, day: number, credits: Credit[]): Credit[] {
  const keyword = normalizeKeyword(matchText);
  if (!keyword || !(partCents > 0)) return [];
  return credits
    .filter((c) => eligible(c, keyword, partCents, day))
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date));
}

/**
 * A salary is not the same every month: an income has arrived once each of
 * its parts came in as a transfer of roughly the expected size (≥ 70%), or
 * (almost) its whole amount did.
 */
const WHOLE_PART = 0.7;
function arrived(st: { income: ExpectedIncome; received: number; whole: number }): boolean {
  return st.whole >= Math.max(1, st.income.parts) || st.received >= st.income.amount_cents * 0.95;
}

/**
 * For each income due in `month`: what already arrived (this month's credits)
 * and what is still to come. Each movement counts for one income only, best
 * fits first (closest amount and day), so a refund or a separate subsídio
 * does not take the salary's place once the salary itself is there.
 */
export function incomeStatus(
  incomes: ExpectedIncome[],
  monthCredits: Credit[],
  month: string,
  today: string,
): IncomeStatus[] {
  const due = incomes.filter((i) => isDueInMonth(i, month));
  const credits = monthCredits.filter((c) => c.amount_cents > 0 && c.booking_date.slice(0, 7) === month);
  const todayDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : today.slice(0, 7) > month ? 99 : 0;

  const state = due.map((income) => ({
    income,
    keyword: normalizeKeyword(income.match_text ?? ""),
    part: income.amount_cents / Math.max(1, income.parts),
    received: 0,
    ids: [] as string[],
    /** Transfers that look like a whole part (amounts vary month to month). */
    whole: 0,
  }));
  const pairs: { st: (typeof state)[number]; c: Credit; score: number }[] = [];
  for (const st of state) {
    if (!st.keyword) continue;
    for (const c of credits) {
      if (eligible(c, st.keyword, st.part, st.income.day, maxPartFor(st.income, incomes))) pairs.push({ st, c, score: fitScore(c, st.part, st.income.day) });
    }
  }
  pairs.sort((x, y) => x.score - y.score || x.c.booking_date.localeCompare(y.c.booking_date));
  const used = new Set<string>();
  for (const { st, c } of pairs) {
    if (used.has(c.id) || arrived(st)) continue;
    used.add(c.id);
    st.received += c.amount_cents;
    st.ids.push(c.id);
    if (c.amount_cents >= st.part * WHOLE_PART) st.whole++;
  }

  return state.map((st): IncomeStatus => {
    const { income, keyword, received, ids } = st;
    if (!keyword) {
      const arrived = todayDay > income.day;
      return { income, receivedCents: arrived ? income.amount_cents : 0, pendingCents: arrived ? 0 : income.amount_cents, detectable: false, creditIds: [] };
    }
    const pending = arrived(st) ? 0 : income.amount_cents - received;
    return { income, receivedCents: received, pendingCents: Math.max(0, pending), detectable: true, creditIds: ids };
  });
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
