import { supabase } from "@/lib/supabase";
import type { BankConnection } from "@/lib/types";

export const BANK_CALLBACK_PATH = "/ligar-banco/callback";

export async function getConnection(
  householdId: string,
): Promise<BankConnection | null> {
  const { data } = await supabase
    .from("bank_connections")
    .select("*")
    .eq("household_id", householdId)
    .maybeSingle();
  return (data as BankConnection) ?? null;
}

function unwrap<T>(data: T | { error?: string } | null, error: unknown): T {
  if (error) throw error instanceof Error ? error : new Error(String(error));
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}

/** Start the Enable Banking flow; returns the URL to send the user to. */
export async function startAuth(): Promise<string> {
  const redirect_url = `${window.location.origin}${BANK_CALLBACK_PATH}`;
  const { data, error } = await supabase.functions.invoke("eb-auth-start", {
    body: { redirect_url },
  });
  const res = unwrap<{ url: string }>(data, error);
  return res.url;
}

/** Complete the flow after the bank redirects back with code + state. */
export async function completeCallback(
  code: string,
  state: string,
): Promise<{ accounts: number }> {
  const { data, error } = await supabase.functions.invoke("eb-callback", {
    body: { code, state },
  });
  return unwrap<{ ok: boolean; accounts: number }>(data, error);
}

export async function syncNow(
  householdId: string,
): Promise<{ processed: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke("eb-sync", {
    body: { household_id: householdId },
  });
  return unwrap<{ processed: number; error?: string }>(data, error);
}

/** Days until the consent expires (negative = already expired). */
export function daysUntil(validUntil: string | null): number | null {
  if (!validUntil) return null;
  const ms = new Date(validUntil).getTime() - Date.now();
  return Math.floor(ms / (24 * 3600 * 1000));
}
