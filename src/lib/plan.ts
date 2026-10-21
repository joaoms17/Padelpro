// The plan engine lives in supabase/functions/_shared/engine (the Edge
// Functions use it too); this keeps `@/lib/plan` working for the app.
export * from "@shared/engine/plan.ts";
