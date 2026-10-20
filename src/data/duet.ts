import { invokeFn } from "@/lib/invoke";
import { errorMessage } from "@/lib/errors";
import type { DuetEvent } from "@shared/duet";

export type { DuetEvent };

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
