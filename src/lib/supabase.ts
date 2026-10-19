import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the frontend has been pointed at a real Supabase project. */
export const isSupabaseConfigured = Boolean(url && anonKey);

// When not configured (fresh clone, no .env) we still export a client so the
// app renders — calls will fail clearly and the UI shows a setup notice.
export const supabase: SupabaseClient = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // OTP code flow, no magic-link URL parsing
    },
  },
);
