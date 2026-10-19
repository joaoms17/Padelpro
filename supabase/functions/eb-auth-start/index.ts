// eb-auth-start — begins the Enable Banking authorization flow.
// Returns a URL the user opens to authorize access in the Santander app.
import { corsHeaders, json } from "../_shared/cors.ts";
import { householdFromRequest, serviceClient } from "../_shared/db.ts";
import { findSantanderPT, ebFetch } from "../_shared/eb.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await householdFromRequest(req);
    if (!ctx) return json({ error: "não autenticado" }, 401);

    const { redirect_url } = await req.json().catch(() => ({}));
    if (!redirect_url) return json({ error: "redirect_url em falta" }, 400);

    const aspsp = await findSantanderPT();
    const svc = serviceClient();
    const { data: stateRow, error } = await svc
      .from("eb_auth_requests")
      .insert({ household_id: ctx.householdId })
      .select("state")
      .single();
    if (error) throw error;

    const validitySec = aspsp.maximum_consent_validity ?? 90 * 24 * 3600;
    const validUntil = new Date(Date.now() + validitySec * 1000).toISOString();

    const auth = await ebFetch<{ url: string }>("/auth", {
      method: "POST",
      body: {
        access: { valid_until: validUntil },
        aspsp: { name: aspsp.name, country: "PT" },
        state: stateRow.state,
        redirect_url,
        psu_type: "personal",
      },
    });

    return json({ url: auth.url, aspsp: aspsp.name });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
