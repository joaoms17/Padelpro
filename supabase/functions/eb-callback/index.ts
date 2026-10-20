// eb-callback — completes authorization: exchanges the code for a session,
// stores the connection + accounts, and does an initial sync.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { ebFetch } from "../_shared/eb.ts";
import { syncHousehold } from "../_shared/sync.ts";
import { planAccountLinks, type SessionAccount, type StoredAccount } from "../_shared/accounts.ts";

// POST /sessions returns account OBJECTS (GET /sessions/{id} returns uid strings).
interface SessionResp {
  session_id: string;
  accounts?: SessionAccount[];
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

    // The code is single-use: whatever happens next, this state is spent.
    await svc.from("eb_auth_requests").delete().eq("state", state);

    // In restricted production mode only accounts linked in the Enable Banking
    // Control Panel are returned — none means none were linked.
    const sessionAccounts = (session.accounts ?? []).filter((a) => a && a.uid);
    if (sessionAccounts.length === 0) {
      return json({
        error:
          "O banco não devolveu nenhuma conta. Na Enable Banking (Control Panel → a tua app) faz \"Link accounts\" com o Santander e volta a ligar.",
      }, 400);
    }

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

    const { data: existing } = await svc
      .from("accounts")
      .select("id, role, eb_account_uid, eb_identification_hash, iban_last4")
      .eq("household_id", householdId);
    const plan = planAccountLinks((existing ?? []) as StoredAccount[], sessionAccounts);

    for (const u of plan.update) {
      const { id, ...fields } = u;
      const { error } = await svc.from("accounts").update(fields).eq("id", id);
      if (error) throw error;
    }
    for (const ins of plan.insert) {
      const { error } = await svc.from("accounts").insert({ household_id: householdId, role: "outra", ...ins });
      if (error) throw error;
    }
    if (plan.unlink.length) {
      await svc.from("accounts").update({ eb_account_uid: null }).in("id", plan.unlink);
    }
    const linked = plan.update.length + plan.insert.length;

    // Initial pull (within the consent's first hour: full history available) so data shows up immediately.
    const sync = await syncHousehold(svc, householdId);

    return json({ ok: true, accounts: linked, sync });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
