// Supabase clients for Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

/** Service-role client — bypasses RLS. Use only inside Edge Functions. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Resolve the household of the caller from their Supabase JWT. */
export async function householdFromRequest(
  req: Request,
): Promise<{ userId: string; householdId: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return null;

  const svc = serviceClient();
  const { data: member } = await svc
    .from("members")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!member) return null;
  return { userId: userData.user.id, householdId: member.household_id as string };
}
