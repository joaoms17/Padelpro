// eb-callback — completes authorization: exchanges the code for a session,
// stores the connection + accounts, and does an initial sync.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { ebFetch } from "../_shared/eb.ts";
import { syncHousehold } from "../_shared/sync.ts";

interface SessionResp {
  session_id: string;
  accounts?: Array<string | { uid: string; account_id?: { iban?: string } }>;
  aspsp?: { name?: string };
  access?: { valid_until?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { code, state } = await req.json().catch(() => ({}));
    if (!code || !state) return json({ error: "code/state em falta" }, 400);

    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);

    const svc = serviceClient();
    const { data: reqRow } = await svc
      .from("eb_auth_requests")
      .select("household_id, created_at")
      .eq("state", state)
      .maybeSingle();
    // The state must belong to the caller's household and be recent (1h).
    const fresh = reqRow && Date.now() - new Date(reqRow.created_at as string).getTime() < 3600_000;
    if (!reqRow || !fresh || reqRow.household_id !== ctx.householdId) {
      return json({ error: "estado inválido ou expirado — volta a ligar o banco" }, 400);
    }
    const householdId = ctx.householdId;

    const session = await ebFetch<SessionResp>("/sessions", {
      method: "POST",
      body: { code },
    });

    await svc.from("bank_connections").upsert(
      {
        household_id: householdId,
        aspsp_name: session.aspsp?.name ?? "Santander",
        session_id: session.session_id,
        valid_until: session.access?.valid_until ?? null,
        status: "active",
        last_error: null,
      },
      { onConflict: "household_id" },
    );

    // Attach EB accounts: first one links to the existing Conta Casa, the rest
    // are added as secondary ('outra') accounts.
    const { data: existing } = await svc
      .from("accounts")
      .select("id, role, eb_account_uid")
      .eq("household_id", householdId);

    const byUid = new Map(
      (existing ?? []).filter((a) => a.eb_account_uid).map((a) => [a.eb_account_uid as string, a]),
    );
    const casa = (existing ?? []).find((a) => a.role === "casa" && !a.eb_account_uid);

    const accounts = session.accounts ?? [];
    let linked = 0;
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      const uid = typeof a === "string" ? a : a.uid;
      const iban = typeof a === "string" ? undefined : a.account_id?.iban;
      const last4 = iban ? iban.slice(-4) : null;
      if (!uid) continue;

      // Already linked (re-link / renew): refresh, never duplicate.
      const already = byUid.get(uid);
      if (already) {
        await svc.from("accounts").update({ iban_last4: last4 }).eq("id", already.id);
      } else if (i === 0 && casa) {
        await svc
          .from("accounts")
          .update({ eb_account_uid: uid, iban_last4: last4 })
          .eq("id", casa.id);
      } else {
        await svc.from("accounts").insert({
          household_id: householdId,
          name: `Conta ${last4 ?? i + 1}`,
          role: "outra",
          eb_account_uid: uid,
          iban_last4: last4,
        });
      }
      linked++;
    }

    await svc.from("eb_auth_requests").delete().eq("state", state);

    // Initial pull so data shows up immediately.
    const sync = await syncHousehold(svc, householdId);

    return json({ ok: true, accounts: linked, sync });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
