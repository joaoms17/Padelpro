// Supabase clients for Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

/** First key of a JSON env var like SUPABASE_SECRET_KEYS={"default":"sb_secret_…"}. */
function firstKey(name: string): string | undefined {
  try {
    const keys = JSON.parse(Deno.env.get(name) ?? "{}") as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch (_e) {
    return undefined;
  }
}

/** Service key: legacy service_role JWT, or the new sb_secret_… key. */
export function serviceKey(): string {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || firstKey("SUPABASE_SECRET_KEYS");
  if (!key) throw new Error("Chave de serviço do Supabase indisponível na função.");
  return key;
}

/** Service-role client — bypasses RLS. Use only inside Edge Functions. */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
    auth: { persistSession: false },
  });
}

/** Resolve the household of the caller from their Supabase JWT. */
export async function householdFromRequest(
  req: Request,
): Promise<{ userId: string; householdId: string } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  // The functions run with verify_jwt = false (config.toml), so the token is
  // validated here, by the Auth server (works for legacy and new signing keys).
  const svc = serviceClient();
  const { data: userData } = await svc.auth.getUser(token);
  if (!userData.user) return null;

  const { data: member } = await svc
    .from("members")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!member) return null;
  return { userId: userData.user.id, householdId: member.household_id as string };
}
