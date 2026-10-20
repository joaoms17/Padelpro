// Recognises calls from pg_cron (and the deploy smoke tests).
// Crons send `x-cron-secret: <CRON_SECRET>`; the value lives in the function
// secrets and in Supabase Vault (name `cron_secret`), both set by the deploy
// workflow. A Bearer service key is still accepted for manual calls.
import { serviceKey } from "./db.ts";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isCronRequest(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (safeEqual(req.headers.get("x-cron-secret") ?? "", cronSecret)) return true;

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  try {
    return safeEqual(bearer, serviceKey());
  } catch (_e) {
    return false;
  }
}
