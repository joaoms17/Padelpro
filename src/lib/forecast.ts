// Expected incomes: when each one is due, what of it already arrived this
// month and what is still to come; regular incomes found in the bank. Pure
// and testable.
import {
  isUsableKeyword,
  normalizeKeyword,
  suggestRuleKeyword,
} from "@shared/categorize";
import { monthDiff, type Credit, type ExpectedIncome } from "@shared/engine/forecast.ts";

// When an income is due and what of it arrived: shared with the Edge Functions.
export * from "@shared/engine/forecast.ts";

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
