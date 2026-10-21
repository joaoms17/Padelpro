// duet-events — Joana's events (and what is still to receive) from the Duet
// app, a separate Supabase project. Read-only: the key (DUET_SECRET_KEY, a
// secret key of that project) never leaves the server, and only the fields
// the forecast needs are returned to members of the household.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest } from "../_shared/db.ts";
import { isCronRequest } from "../_shared/auth.ts";
import { validRange } from "../_shared/duet.ts";
import { duetClient, readDuet, readReceipts } from "../_shared/duetRead.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);

    // Deploy smoke test: proves the key works, without returning any event.
    if (body?.check) {
      if (!isCronRequest(req)) return json({ error: "não autenticado" }, 401);
      if (!duetClient()) return json({ configured: false });
      const year = today.slice(0, 4);
      const events = await readDuet(`${year}-01-01`, `${year}-12-31`, today);
      return json({ configured: true, events: events.length });
    }

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);
    if (!duetClient()) return json({ configured: false, events: [], receipts: [] });

    const range = validRange(body?.from, body?.to);
    if (!range) return json({ error: "intervalo de datas inválido" }, 400);
    if (body?.receipts) return json({ configured: true, receipts: await readReceipts(range.from, range.to) });
    return json({ configured: true, events: await readDuet(range.from, range.to, today) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
