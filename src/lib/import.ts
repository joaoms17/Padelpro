// Statement import — pure, testable logic (no I/O, no Supabase).
// Parses a bank export (CSV/TSV, or rows already read from XLSX), maps the
// columns, and builds dedup-stable transactions. The dedup key mirrors the
// spec: external_id derived from booking_date + amount + remittance, with an
// occurrence sequence so genuine same-day/same-amount repeats are preserved
// while re-importing the same statement never duplicates.

import { parseCents } from "./format";

export type AmountMode = "single" | "split";

export interface Mapping {
  dateCol: number;
  descCol: number;
  amountMode: AmountMode;
  amountCol?: number; // single signed column
  inCol?: number; // credit (entrada)
  outCol?: number; // debit (saída)
  dateFormat: "dmy" | "ymd";
}

export interface ParsedTx {
  external_id: string;
  booking_date: string; // ISO yyyy-mm-dd
  amount_cents: number; // + entrada, - saída
  description_raw: string;
}

export interface ImportResult {
  items: ParsedTx[];
  skippedRows: number; // rows that could not be parsed (no date/amount)
}

/** Split delimited text into rows, auto-detecting the delimiter (; , or tab). */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, ""); // strip BOM
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const counts: Record<string, number> = {
    ";": (firstLine.match(/;/g) ?? []).length,
    ",": (firstLine.match(/,/g) ?? []).length,
    "\t": (firstLine.match(/\t/g) ?? []).length,
  };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    ";") as string;

  return clean
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => splitLine(line, delim));
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delim && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

const DATE_HINTS = ["data", "date", "mov", "valor_data", "data mov"];
const DESC_HINTS = ["descri", "descriç", "movimento", "detalhe", "concept", "remittance"];
const AMOUNT_HINTS = ["montante", "valor", "amount", "importância", "importancia"];
const IN_HINTS = ["crédito", "credito", "credit", "entrada"];
const OUT_HINTS = ["débito", "debito", "debit", "saída", "saida"];

/** Find the header row and a best-guess column mapping. Returns null if none. */
export function detectTable(
  rows: string[][],
): { headerIndex: number; mapping: Mapping } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const header = rows[i].map((c) => c.toLowerCase());
    // Claim columns in priority order so a header like "Data Movimento" (which
    // matches both a date hint and the "movimento" desc hint) goes to the date.
    const find = (hints: string[], exclude: number[]) =>
      header.findIndex(
        (h, idx) => !exclude.includes(idx) && hints.some((hint) => h.includes(hint)),
      );

    const dateCol = find(DATE_HINTS, []);
    if (dateCol === -1) continue;

    const inCol = find(IN_HINTS, [dateCol]);
    const outCol = find(OUT_HINTS, [dateCol, inCol]);
    const amountCol = find(AMOUNT_HINTS, [dateCol, inCol, outCol]);
    const split = inCol !== -1 && outCol !== -1;
    if (!split && amountCol === -1) continue;

    const used = [dateCol, inCol, outCol, amountCol].filter((c) => c !== -1);
    let descCol = find(DESC_HINTS, used);
    if (descCol === -1) {
      // fall back to the first column not already claimed
      descCol = header.findIndex((_, idx) => !used.includes(idx));
      if (descCol === -1) descCol = dateCol + 1;
    }

    return {
      headerIndex: i,
      mapping: {
        dateCol,
        descCol,
        amountMode: split ? "split" : "single",
        amountCol: split ? undefined : amountCol,
        inCol: split ? inCol : undefined,
        outCol: split ? outCol : undefined,
        dateFormat: "dmy",
      },
    };
  }
  return null;
}

/** Parse "dd/mm/yyyy", "dd-mm-yyyy" or "yyyy-mm-dd" into ISO yyyy-mm-dd. */
export function parseDateToISO(
  raw: string,
  fmt: "dmy" | "ymd" = "dmy",
): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/);
  if (!m) return null;
  let d: number, mo: number, y: number;
  if (fmt === "ymd" || m[1].length === 4) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else {
    d = +m[1];
    mo = +m[2];
    y = +m[3];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, "0")}-${mo
    .toString()
    .padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

/** Normalise remittance text for a stable dedup key. */
export function normalizeRemittance(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w ]/g, "")
    .trim();
}

// FNV-1a 32-bit — deterministic, sync, good enough for a dedup discriminator.
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Dedup-stable external_id. seq disambiguates identical repeats in a file. */
export function computeExternalId(
  bookingDate: string,
  amountCents: number,
  remittance: string,
  seq: number,
): string {
  return `imp:${bookingDate}:${amountCents}:${fnv1a(normalizeRemittance(remittance))}:${seq}`;
}

function rowAmountCents(row: string[], m: Mapping): number | null {
  if (m.amountMode === "single" && m.amountCol != null) {
    return parseCents(row[m.amountCol] ?? "");
  }
  if (m.amountMode === "split") {
    const inC = m.inCol != null ? (parseCents(row[m.inCol] ?? "") ?? 0) : 0;
    const outC = m.outCol != null ? (parseCents(row[m.outCol] ?? "") ?? 0) : 0;
    if (inC === 0 && outC === 0) return null;
    // credit positive, debit negative (out columns may already be positive)
    return inC - Math.abs(outC);
  }
  return null;
}

/** Build dedup-stable transactions from parsed rows. */
export function buildImport(
  rows: string[][],
  mapping: Mapping,
  dataStartIndex: number,
): ImportResult {
  const items: ParsedTx[] = [];
  const seqByKey = new Map<string, number>();
  let skipped = 0;

  for (let i = dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    const date = parseDateToISO(row[mapping.dateCol] ?? "", mapping.dateFormat);
    const amount = rowAmountCents(row, mapping);
    if (!date || amount == null) {
      skipped++;
      continue;
    }
    const desc = (row[mapping.descCol] ?? "").trim();
    const key = `${date}|${amount}|${normalizeRemittance(desc)}`;
    const seq = seqByKey.get(key) ?? 0;
    seqByKey.set(key, seq + 1);

    items.push({
      external_id: computeExternalId(date, amount, desc, seq),
      booking_date: date,
      amount_cents: amount,
      description_raw: desc,
    });
  }

  return { items, skippedRows: skipped };
}

const DAY = 86400000;
const toDayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * Statement rows the bank sync already stored: matched one-to-one with a bank
 * row of the same amount and a booking date within ±maxDays (card payments
 * are booked a day or two after the purchase). Each bank row covers at most
 * one statement row, so two identical purchases stay two.
 */
export function matchBankCovered<T extends { booking_date: string; amount_cents: number }>(
  items: T[],
  bank: { booking_date: string; amount_cents: number }[],
  maxDays = 3,
): Set<T> {
  const covered = new Set<T>();
  const claimed = new Set<number>();
  for (const it of [...items].sort((x, y) => x.booking_date.localeCompare(y.booking_date))) {
    const t = toDayMs(it.booking_date);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < bank.length; i++) {
      if (claimed.has(i) || bank[i].amount_cents !== it.amount_cents) continue;
      const d = Math.abs(toDayMs(bank[i].booking_date) - t);
      if (d <= maxDays * DAY && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) {
      claimed.add(best);
      covered.add(it);
    }
  }
  return covered;
}
