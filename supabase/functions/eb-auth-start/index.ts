// eb-auth-start — begins the Enable Banking authorization flow.
// Returns a URL the user opens to authorize access in the Santander app.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { findSantanderPT, ebFetch, getApplication, type EBApplication } from "../_shared/eb.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);

    const { redirect_url } = await req.json().catch(() => ({}));
    if (!redirect_url) return json({ error: "redirect_url em falta" }, 400);

    // Fail early with a readable reason instead of a bank-side error page.
    // (Best-effort: if the lookup itself fails, the bank flow still runs.)
    const app = await getApplication().catch(() => ({} as EBApplication));
    if (app.active === false) {
      return json({
        error:
          "A app Enable Banking ainda não está ativa — no Control Panel usa \"Activate by linking accounts\" com o Santander.",
      }, 400);
    }
    // Send the registered URL byte-for-byte (tolerating a trailing slash).
    const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
    const registered = app.redirect_urls?.find((u) => norm(u) === norm(redirect_url));
    if (app.redirect_urls?.length && !registered) {
      return json({
        error: `Este endereço não está registado na Enable Banking: ${redirect_url}. ` +
          `Registados: ${app.redirect_urls.join(", ") || "nenhum"}. Abre a app pelo endereço registado ou acrescenta este no Control Panel.`,
      }, 400);
    }

    const aspsp = await findSantanderPT();
    const svc = serviceClient();
    const { data: stateRow, error } = await svc
      .from("eb_auth_requests")
      .insert({ household_id: ctx.householdId })
      .select("state")
      .single();
    if (error) throw error;

    // maximum_consent_validity is in seconds; stay a little under the cap.
    const validitySec = (aspsp.maximum_consent_validity ?? 90 * 24 * 3600) - 3600;
    const validUntil = new Date(Date.now() + validitySec * 1000).toISOString();

    const auth = await ebFetch<{ url: string }>("/auth", {
      method: "POST",
      body: {
        access: { valid_until: validUntil },
        aspsp: { name: aspsp.name, country: "PT" },
        state: stateRow.state,
        redirect_url: registered ?? redirect_url,
        psu_type: "personal",
      },
    });

    return json({ url: auth.url, aspsp: aspsp.name });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
