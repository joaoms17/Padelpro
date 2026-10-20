import { invokeFn } from "@/lib/invoke";
import { errorMessage } from "@/lib/errors";
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
