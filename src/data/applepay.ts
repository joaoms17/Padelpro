import { supabase } from "@/lib/supabase";

export interface IngestToken {
  id: string;
  member_id: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** The URL the iPhone Shortcut POSTs to. */
export function ingestUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/ingest-applepay`;
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `cad_${hex}`;
}

/**
 * Create a personal ingest token. Only its SHA-256 hash is stored; the raw
 * token is returned once for the user to copy into the Shortcut.
 */
export async function generateToken(memberId: string): Promise<string> {
  const token = randomToken();
  const token_hash = await sha256hex(token);
  const { error } = await supabase
    .from("ingest_tokens")
    .insert({ member_id: memberId, token_hash });
  if (error) throw error;
  return token;
}

export async function listTokens(memberId: string): Promise<IngestToken[]> {
  const { data } = await supabase
    .from("ingest_tokens")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  return (data as IngestToken[]) ?? [];
}

export async function revokeToken(id: string): Promise<void> {
  const { error } = await supabase
    .from("ingest_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
