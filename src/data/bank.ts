import { supabase } from "@/lib/supabase";
import { invokeFn } from "@/lib/invoke";
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

/** Start the Enable Banking flow; returns the URL to send the user to. */
export async function startAuth(): Promise<string> {
  const redirect_url = `${window.location.origin}${BANK_CALLBACK_PATH}`;
  const res = await invokeFn<{ url: string }>("eb-auth-start", { redirect_url });
  return res.url;
}

/** Complete the flow after the bank redirects back with code + state. */
export async function completeCallback(
  code: string,
  state: string,
): Promise<{ accounts: number }> {
  return invokeFn<{ ok: boolean; accounts: number }>("eb-callback", { code, state });
}

export async function syncNow(
  householdId: string,
): Promise<{ processed: number; error?: string }> {
  return invokeFn<{ processed: number; error?: string }>("eb-sync", { household_id: householdId });
}

/** Days until the consent expires (negative = already expired). */
export function daysUntil(validUntil: string | null): number | null {
  if (!validUntil) return null;
  const ms = new Date(validUntil).getTime() - Date.now();
  return Math.floor(ms / (24 * 3600 * 1000));
}
