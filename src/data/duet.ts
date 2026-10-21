import { useEffect, useState } from "react";
import { invokeFn } from "@/lib/invoke";
import { errorMessage } from "@/lib/errors";
import { daysInMonth } from "@/lib/budget";
import type { DuetEvent, DuetReceipt } from "@shared/duet";

export type { DuetEvent, DuetReceipt };

export interface DuetResult {
  /** False until DUET_SECRET_KEY is set up on the server. */
  configured: boolean;
  events: DuetEvent[];
  error?: string;
}

/** Joana's events from the Duet app between two dates (never throws). */
export async function loadDuetEvents(from: string, to: string): Promise<DuetResult> {
  try {
    const r = await invokeFn<{ configured: boolean; events?: DuetEvent[] }>("duet-events", { from, to });
    return { configured: !!r.configured, events: r.events ?? [] };
  } catch (e) {
    return { configured: false, events: [], error: errorMessage(e) };
  }
}

export interface DuetReceiptsResult {
  configured: boolean;
  receipts: DuetReceipt[];
  error?: string;
}

/** What Joana marked as received in Duet between two dates, by payment date (never throws). */
export async function loadDuetReceipts(from: string, to: string): Promise<DuetReceiptsResult> {
  try {
    const r = await invokeFn<{ configured: boolean; receipts?: DuetReceipt[] }>("duet-events", { from, to, receipts: true });
    return { configured: !!r.configured, receipts: r.receipts ?? [] };
  } catch (e) {
    return { configured: false, receipts: [], error: errorMessage(e) };
  }
}

/** "2026-11" → "2026-11-30". */
export const lastDayOf = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** What Joana marked as received on Duet in one month. */
export interface DuetMonth {
  /** False while Duet is not set up (or could not be reached: see `error`). */
  configured: boolean;
  /** The month's total received. */
  cents: number;
  /** How many receipts. */
  count: number;
  error?: string;
}

/** A month's Duet receipts, summed (null while loading; never throws). */
export function useDuetMonth(month: string): DuetMonth | null {
  const [res, setRes] = useState<{ month: string; value: DuetMonth } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDuetReceipts(`${month}-01`, lastDayOf(month)).then((r) => {
      if (!alive) return;
      const cents = r.receipts.reduce((a, x) => a + x.amount_cents, 0);
      setRes({ month, value: { configured: r.configured, cents, count: r.receipts.length, error: r.error } });
    });
    return () => {
      alive = false;
    };
  }, [month]);
  // A month just switched to shows "loading", never the one before.
  return res && res.month === month ? res.value : null;
}
