// Formatting helpers — PT-PT, euros as "1 234,56 €", dates dd/mm/aaaa.
// Monetary values are stored as cents (bigint); positive = entrada, negative = saída.

/** "1234567" → "1 234 567" (pt-PT leaves 4-digit numbers ungrouped; here they always are). */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

/** "1 234,56" for |cents|. */
function euroDigits(cents: number): string {
  const abs = Math.round(Math.abs(cents));
  return `${group(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, "0")}`;
}

/** Format cents as "1 234,56 €". Keeps the sign. */
export function formatCents(cents: number): string {
  return `${cents < 0 ? "-" : ""}${euroDigits(cents)}\u00a0€`;
}

/** Format cents as a plain "1 234,56 €" with explicit +/- prefix. */
export function formatSigned(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${euroDigits(cents)}\u00a0€`;
}

/** Parse user text like "12,34 €" or "12.34" or "1 234,56" into cents. */
export function parseCents(text: string): number | null {
  if (!text) return null;
  const cleaned = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // thousands dot
    .replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

const dateFmt = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Lisbon",
});

export function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return dateFmt.format(date);
}

export function formatMonth(month: string): string {
  // month: "2026-05" → "Maio 2026"
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, 1);
  return new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Lisbon",
  }).format(date);
}

export function formatPct(ratio: number): string {
  return `${new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(ratio * 100)}%`;
}

/** Summary amounts, to the euro: "1 234 €" — thousands always grouped (pt-PT leaves 4 digits alone). */
export function formatEuros(cents: number): string {
  const n = Math.sign(cents) * Math.round(Math.abs(cents) / 100);
  return `${n < 0 ? "-" : ""}${group(String(Math.abs(n)))}\u00a0€`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-09" → "setembro". */
export function monthName(month: string): string {
  return MESES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "2026-09" → "Set". */
export function monthShort(month: string): string {
  const n = monthName(month);
  return n.charAt(0).toUpperCase() + n.slice(1, 3);
}

/** "2026-09" → "Setembro 2026". */
export function monthTitle(month: string): string {
  const n = monthName(month);
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${month.slice(0, 4)}`;
}

/** "2026-09" → "30 de setembro" / "1 de setembro". */
export function monthDay(month: string, which: "first" | "last"): string {
  const [y, m] = month.split("-").map(Number);
  const d = which === "first" ? 1 : new Date(y, m, 0).getDate();
  return `${d} de ${monthName(month)}`;
}

/** Days of the month as "dia 23" / "dias 11 e 12" / "dias 3, 9 e 20". */
export function daysLabel(days: number[]): string {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  if (ds.length === 0) return "";
  if (ds.length === 1) return `dia ${ds[0]}`;
  return `dias ${ds.slice(0, -1).join(", ")} e ${ds[ds.length - 1]}`;
}
