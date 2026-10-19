// Formatting helpers — PT-PT, euros as "1 234,56 €", dates dd/mm/aaaa.
// Monetary values are stored as cents (bigint); positive = entrada, negative = saída.

const eur = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

const eurNoSign = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format cents as "1 234,56 €". Keeps the sign. */
export function formatCents(cents: number): string {
  return eur.format(cents / 100);
}

/** Format cents as a plain "1 234,56 €" with explicit +/- prefix. */
export function formatSigned(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${eurNoSign.format(Math.abs(cents) / 100)} €`;
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
